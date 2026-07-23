/**
 * At-risk scan cron.
 *
 * Pulls engagement snapshots for each company, scores them, and raises alerts
 * for members newly in the high-risk band. Schedule daily. Secured with the
 * same CRON_SECRET bearer token as the dunning processor.
 *
 * NOTE: needs the Whop activity data wired in src/lib/engagement.ts to produce
 * real snapshots — until then it runs and safely finds nothing.
 */

import type { NextRequest } from "next/server";
import { getEngine } from "@/lib/runtime";
import { getEngagementProvider } from "@/lib/engagement";

export async function POST(request: NextRequest): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }

  const companyId = new URL(request.url).searchParams.get("company");
  if (!companyId) {
    return new Response("missing ?company", { status: 400 });
  }

  const provider = getEngagementProvider();
  const snapshots = await provider.snapshots(companyId);
  const assessments = await getEngine().scanAtRisk(companyId, snapshots);

  const high = assessments.filter((a) => a.band === "high").length;
  return Response.json({ ok: true, scanned: assessments.length, highRisk: high });
}

export const GET = POST;
