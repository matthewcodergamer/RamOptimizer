# Billing service

This service is separate from the Chrome extension.

## Stack

- Stripe Checkout for recurring Pro subscriptions.
- Stripe Billing Portal for subscription management.
- RS256-signed license tokens. The extension embeds only the public key.
- No browsing history, tab URLs, or extension telemetry is sent to this service.

## Setup

1. Create a recurring Stripe Price for Browser Performance Manager Pro.
2. Copy `server/.env.example` to `.env` and fill in the Stripe values.
3. Run `./generate-license-keys.sh`.
4. Keep `private-license-key.pem` out of Git and out of the extension package.
5. Copy `public-license-key.pem` into `premium.js`, replacing the placeholder public key.
6. Set `PUBLIC_APP_URL` to your real HTTPS billing site.
7. Run `npm install` and `npm start` inside `server/`.
8. Configure Stripe webhooks to POST to `/webhook` and set `STRIPE_WEBHOOK_SECRET`.
9. Set `BPM_BILLING_URL` in `premium-config.js` to your pricing/checkout page.

## License flow

Checkout creates a Stripe subscription. The success page calls `claim-license` with the Checkout Session ID. The server re-checks the completed session and current subscription, then signs a Pro token that expires at the current billing period end. The extension verifies that token locally with the embedded public key.

This keeps Stripe secret keys and signing keys off the extension. If you later need instant revocation or automatic license refresh after renewals, add a narrowly scoped HTTPS license-status endpoint and use that single origin as a host permission.

## Store compliance

Chrome Web Store policy requires clear disclosure of paid functionality, seller identity, and terms/refund information when accepting payment. The Store listing and billing site should state exactly what Pro adds and make clear that you, not Google, are the seller.
