/**
 * Runs the historical backfill scan for the calling company.
 *
 * Admin-gated: only a team member/owner of the company can trigger it.
 * Idempotent — safe to call repeatedly (already-open cases are skipped, not
 * duplicated). The dashboard calls this automatically the first time an
 * admin opens it, and exposes a manual "Scan again" button after that.
 */

import type { NextRequest } from "next/server";
import { accessLevel, verifyWhopViewer } from "@/lib/auth";
import { backfillCompany } from "@/lib/backfill";
import { getStore } from "@/lib/runtime";

export async function POST(request: NextRequest): Promise<Response> {
  const viewer = await verifyWhopViewer();
  if (!viewer) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let companyId: string | undefined;
  try {
    const body = await request.json();
    companyId = typeof body?.companyId === "string" ? body.companyId : undefined;
  } catch {
    // companyId stays undefined — caught below.
  }
  if (!companyId) {
    return Response.json({ error: "missing companyId" }, { status: 400 });
  }

  const level = await accessLevel(viewer.userId, companyId);
  if (level !== "admin") {
    return Response.json({ error: "admins only" }, { status: 403 });
  }

  try {
    const result = await backfillCompany(companyId);

    const store = getStore();
    const existing = await store.getConfig(companyId);
    await store.saveConfig({
      companyId,
      enabled: true,
      communityName: "your community",
      ...existing,
      historicalScanAt: new Date().toISOString(),
      lastScanResult: result,
    });

    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[recover] backfill scan error", err);
    return Response.json({ error: "scan failed" }, { status: 500 });
  }
}
