/**
 * Weekly digest cron — DMs each installed company's admin their "revenue
 * saved this week" summary. Schedule weekly (e.g. Monday 9am in each
 * timezone bucket you care about). Secured with the same CRON_SECRET bearer
 * token as the other cron routes.
 *
 * With no ?company= param it fans out across every installed company;
 * pass one to test/redeliver a single company's digest.
 */

import type { NextRequest } from "next/server";
import { sendAllWeeklyDigests, sendWeeklyDigest } from "@/lib/digest";

export async function POST(request: NextRequest): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const companyId = new URL(request.url).searchParams.get("company");
  const outcomes = companyId
    ? [await sendWeeklyDigest(companyId)]
    : await sendAllWeeklyDigests();

  const sent = outcomes.filter((o) => o.sent).length;
  return Response.json({ ok: true, companies: outcomes.length, sent, outcomes });
}

export const GET = POST;
