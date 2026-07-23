/**
 * Whop SDK client + webhook verification helpers.
 *
 * Docs: https://docs.whop.com/developer/api/getting-started
 *       https://docs.whop.com/developer/guides/webhooks
 */

import { Whop } from "@whop/sdk";

let _client: Whop | null = null;

export function whopClient(): Whop {
  if (_client) return _client;
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY is not set");
  _client = new Whop({
    apiKey,
    // Pass the webhook secret raw — the SDK's unwrap() expects the unmodified
    // signing secret (it also reads WHOP_WEBHOOK_SECRET from env by default).
    webhookKey: process.env.WHOP_WEBHOOK_SECRET ?? undefined,
  });
  return _client;
}
