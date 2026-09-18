// Premium entitlement verification is intentionally offline.
// The private signing key never belongs in the extension. Generate a new key pair
// for production and replace PUBLIC_KEY_PEM with the public key.
//
// License token format: RS256 JWT with:
// { "iss": "browser-performance-manager", "aud": "extension",
//   "plan": "pro", "exp": <unix seconds>, "jti": "<unique id>" }

const PREMIUM_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
REPLACE_WITH_YOUR_PRODUCTION_RSA_PUBLIC_KEY
-----END PUBLIC KEY-----`;

const PREMIUM_ISSUER = 'browser-performance-manager';
const PREMIUM_AUDIENCE = 'extension';

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  const bytes = base64UrlToBytes(value);
  return JSON.parse(new TextDecoder().decode(bytes));
}

function pemToArrayBuffer(pem) {
  const base64 = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

let premiumKeyPromise = null;

async function getPremiumPublicKey() {
  if (premiumKeyPromise) return premiumKeyPromise;
  if (PREMIUM_PUBLIC_KEY_PEM.includes('REPLACE_WITH')) {
    throw new Error('Premium licensing is not configured yet.');
  }

  premiumKeyPromise = crypto.subtle.importKey(
    'spki',
    pemToArrayBuffer(PREMIUM_PUBLIC_KEY_PEM),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return premiumKeyPromise;
}

async function verifyPremiumToken(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    return { active: false, reason: 'invalid' };
  }

  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    const header = decodeJwtPart(encodedHeader);
    const claims = decodeJwtPart(encodedPayload);

    if (header.alg !== 'RS256' || header.typ !== 'JWT') {
      return { active: false, reason: 'invalid' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== PREMIUM_ISSUER || claims.aud !== PREMIUM_AUDIENCE || claims.plan !== 'pro') {
      return { active: false, reason: 'invalid' };
    }
    if (!claims.exp || claims.exp <= now) {
      return { active: false, reason: 'expired', expiresAt: Number(claims.exp || 0) };
    }

    const key = await getPremiumPublicKey();
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );

    if (!valid) return { active: false, reason: 'invalid' };

    return {
      active: true,
      plan: 'pro',
      expiresAt: Number(claims.exp),
      customerId: typeof claims.sub === 'string' ? claims.sub : '',
      features: Array.isArray(claims.features) ? claims.features : []
    };
  } catch (_) {
    return { active: false, reason: 'invalid' };
  }
}
