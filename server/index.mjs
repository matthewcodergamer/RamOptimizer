import http from 'node:http';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Stripe from 'stripe';

const port = Number(process.env.PORT || 8787);
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
const appUrl = String(process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
const priceId = process.env.STRIPE_PRICE_ID || '';

async function readPrivateKey() {
  return fs.readFile(process.env.LICENSE_PRIVATE_KEY_PATH || './private-license-key.pem', 'utf8');
}

function b64(value) { return Buffer.from(value).toString('base64url'); }

async function signLicense(customerId, expiresAt) {
  const privateKey = await readPrivateKey();
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({
    iss: 'browser-performance-manager',
    aud: 'extension',
    sub: customerId,
    plan: 'pro',
    exp: expiresAt,
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    features: ['custom-schedules','quiet-hours','unlimited-protected-sites','performance-history','session-snapshots','turbo-saver']
  }));
  const input = header + '.' + payload;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  return input + '.' + signer.sign(privateKey, 'base64url');
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function page(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function successPage(sessionId) {
  const safe = JSON.stringify(sessionId || '');
  return '<!doctype html><meta charset="utf-8"><title>Browser Performance Manager Pro</title>' +
    '<style>body{font:16px system-ui;max-width:720px;margin:60px auto;padding:24px}textarea{width:100%;min-height:140px}button{padding:10px 14px}</style>' +
    '<h1>Your Browser Performance Manager Pro license</h1>' +
    '<p>Copy this license into Settings, Pro, Activate in the extension. Keep it private.</p>' +
    '<textarea id="license" readonly>Loading...</textarea><p><button id="copy">Copy license</button> <span id="status"></span></p>' +
    '<script>const sessionId=' + safe + ';fetch("/api/claim-license?session_id="+encodeURIComponent(sessionId)).then(r=>r.json()).then(data=>{if(!data.license)throw new Error(data.error||"Could not issue license");document.querySelector("#license").value=data.license;}).catch(e=>document.querySelector("#status").textContent=e.message);document.querySelector("#copy").onclick=async()=>{await navigator.clipboard.writeText(document.querySelector("#license").value);document.querySelector("#status").textContent="Copied";};</script>';
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://' + req.headers.host);

  if (req.method === 'GET' && url.pathname === '/success') {
    return page(res, successPage(url.searchParams.get('session_id')));
  }

  if (req.method === 'POST' && url.pathname === '/api/create-checkout-session') {
    if (!process.env.STRIPE_SECRET_KEY || !priceId || !appUrl) return json(res, 503, { error: 'Billing is not configured.' });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: appUrl + '/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: appUrl + '/',
      metadata: { product: 'browser-performance-manager-pro' }
    });
    return json(res, 200, { url: session.url });
  }

  if (req.method === 'GET' && url.pathname === '/api/claim-license') {
    if (!process.env.STRIPE_SECRET_KEY) return json(res, 503, { error: 'Billing is not configured.' });
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) return json(res, 400, { error: 'Missing session_id.' });
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.mode !== 'subscription' || session.status !== 'complete' || !session.subscription) return json(res, 403, { error: 'Payment has not completed.' });
    const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
    if (!new Set(['active','trialing','past_due']).has(subscription.status)) return json(res, 403, { error: 'Subscription is not active.' });
    const expiresAt = Number(subscription.items.data[0]?.current_period_end || 0);
    if (!expiresAt) return json(res, 500, { error: 'Subscription period could not be determined.' });
    const license = await signLicense(String(session.customer), expiresAt);
    return json(res, 200, { license, expiresAt, customerId: String(session.customer) });
  }

  if (req.method === 'POST' && url.pathname === '/api/customer-portal') {
    const body = JSON.parse(await readBody(req) || '{}');
    if (!body.customerId) return json(res, 400, { error: 'Missing customerId.' });
    const portal = await stripe.billingPortal.sessions.create({ customer: String(body.customerId), return_url: appUrl });
    return json(res, 200, { url: portal.url });
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    const raw = await readBody(req);
    try {
      const event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
      if (['checkout.session.completed','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) console.log('Stripe event:', event.type, event.id);
      return json(res, 200, { received: true });
    } catch (_) {
      return json(res, 400, { error: 'Invalid Stripe webhook signature.' });
    }
  }

  return json(res, 404, { error: 'Not found.' });
}

http.createServer((req, res) => {
  handle(req, res).catch((error) => { console.error(error); json(res, 500, { error: 'Internal server error.' }); });
}).listen(port, () => console.log('Billing server listening on :' + port));