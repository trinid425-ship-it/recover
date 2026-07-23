/**
 * Cron processor — sends any dunning steps that have come due.
 *
 * Wire this to a scheduler (Vercel Cron, GitHub Actions, etc.) hitting it every
 * ~15 minutes with header:  Authorization: Bearer <CRON_SECRET>
 */

import type { NextRequest } from "next/server";
import { getEngine } from "@/lib/runtime";

export async function POST(request: NextRequest): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new Response("unauthorized", { status: 401 });
  }
  const sent = await getEngine().processDue();
  return Response.json({ ok: true, stepsSent: sent });
}

// Allow GET for easy manual/cron triggering too.
export const GET = POST;
