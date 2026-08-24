/**
 * Whop webhook receiver.
 *
 * Verifies the signature manually (see src/lib/verify-webhook.ts — the SDK's
 * client.webhooks.unwrap() assumes a whsec_/base64 secret and cannot verify
 * Whop's ws_<hex> secrets), maps the payload to a normalized EngineEvent, and
 * applies it. Responds 2xx fast; heavy work is minimal here (single case
 * update) so we do it inline, but it is safe to move behind a queue if volume
 * grows.
 *
 * Docs: https://docs.whop.com/developer/guides/webhooks
 */

import type { NextRequest } from "next/server";
import { getEngine } from "@/lib/runtime";
import { mapWebhook } from "@/lib/mapping";
import { verifyWhopWebhook } from "@/lib/verify-webhook";

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers);

  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[recover] WHOP_WEBHOOK_SECRET is not set");
    return new Response("server misconfigured", { status: 500 });
  }

  let event: { type: string; data: Record<string, any> };
  try {
    // Throws on a bad signature — tampered events never reach the engine.
    event = (await verifyWhopWebhook(body, headers, secret)) as any;
  } catch (err) {
    return new Response("invalid signature", { status: 401 });
  }

  const mapped = mapWebhook(event.type, event.data);
  if (!mapped) {
    // Event we don't act on (or missing fields) — acknowledge so Whop stops retrying.
    return new Response("ignored", { status: 200 });
  }

  try {
    const result = await getEngine().handle(mapped);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    // Return 500 so Whop retries (at-least-once delivery).
    console.error("[recover] engine error", err);
    return new Response("engine error", { status: 500 });
  }
}
