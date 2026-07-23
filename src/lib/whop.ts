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
    // The SDK expects the webhook secret base64-encoded (Standard Webhooks).
    webhookKey: process.env.WHOP_WEBHOOK_SECRET
      ? Buffer.from(process.env.WHOP_WEBHOOK_SECRET).toString("base64")
      : undefined,
  });
  return _client;
}
