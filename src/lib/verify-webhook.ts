/**
 * Manual Whop webhook signature verification.
 *
 * The `@whop/sdk` client's `webhooks.unwrap()` delegates to the generic
 * `standardwebhooks` package, which only strips a `whsec_` prefix and then
 * base64-decodes the remainder to get the signing key. Whop issues secrets as
 * `ws_<64 hex chars>`, which doesn't match that convention — the `ws_` prefix
 * is never stripped, so the whole string gets base64-decoded into the wrong
 * key and every signature fails to verify, no matter how correct the secret
 * value is.
 *
 * Whop's docs describe the real scheme directly (see "Verify without an
 * SDK" at https://docs.whop.com/developer/guides/webhooks): HMAC-SHA256 over
 * `{webhook-id}.{webhook-timestamp}.{raw body}`, keyed with the raw `ws_...`
 * secret string (used as-is — not stripped, not decoded). The result is
 * base64-encoded and compared against the `v1,<signature>` in the
 * `webhook-signature` header. This implements that directly with Web Crypto,
 * which works in both the Node and Edge runtimes.
 */

const TOLERANCE_SECONDS = 5 * 60;

export class WebhookVerificationError extends Error {}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function hmacSha256Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Buffer.from(signature).toString("base64");
}

/**
 * Verifies a Whop webhook request and returns the parsed event.
 * Throws WebhookVerificationError on any failure (missing headers, bad
 * signature, stale timestamp).
 */
export async function verifyWhopWebhook(
  body: string,
  headers: Record<string, string>,
  secret: string,
): Promise<{ type: string; data: Record<string, any>; [key: string]: any }> {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  const id = lower["webhook-id"];
  const timestampHeader = lower["webhook-timestamp"];
  const signatureHeader = lower["webhook-signature"];

  if (!id || !timestampHeader || !signatureHeader) {
    throw new WebhookVerificationError("Missing required webhook headers");
  }

  const timestamp = parseInt(timestampHeader, 10);
  if (Number.isNaN(timestamp)) {
    throw new WebhookVerificationError("Invalid webhook-timestamp header");
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) {
    throw new WebhookVerificationError("Webhook timestamp outside tolerance");
  }

  const signedContent = `${id}.${timestamp}.${body}`;
  const expectedSignature = await hmacSha256Base64(secret, signedContent);

  const candidates = signatureHeader.split(" ");
  for (const candidate of candidates) {
    const [version, signature] = candidate.split(",");
    if (version !== "v1" || !signature) continue;
    if (timingSafeEqual(signature, expectedSignature)) {
      return JSON.parse(body);
    }
  }

  throw new WebhookVerificationError("No matching signature found");
}
