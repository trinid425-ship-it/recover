/**
 * Submit dispute evidence — the one irreversible step in the flow.
 *
 * Recover Pro only ever *drafts* evidence automatically (src/lib/disputes.ts,
 * via the safe/reversible `updateEvidence` call). Actually submitting the
 * dispute to the payment processor for review must be a deliberate,
 * admin-gated action taken from the dashboard — this route is that action.
 *
 * Admin check: we don't have the company id in the URL, so we look it up from
 * the dispute itself, then confirm the calling viewer is an admin of that
 * company before allowing the submit.
 */

import type { NextRequest } from "next/server";
import { accessLevel, verifyWhopViewer } from "@/lib/auth";
import { whopClient } from "@/lib/whop";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ disputeId: string }> },
): Promise<Response> {
  const { disputeId } = await params;

  const viewer = await verifyWhopViewer();
  if (!viewer) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  let dispute: any;
  try {
    // Loosely typed — see WhopMessenger/WhopEvidenceDrafter for why.
    dispute = await (whopClient() as any).disputes.retrieve(disputeId);
  } catch (err) {
    return Response.json({ error: "dispute not found" }, { status: 404 });
  }

  const companyId = dispute?.company?.id;
  if (!companyId) {
    return Response.json({ error: "dispute has no associated company" }, { status: 404 });
  }

  const level = await accessLevel(viewer.userId, companyId);
  if (level !== "admin") {
    return Response.json({ error: "admins only" }, { status: 403 });
  }

  if (dispute.editable === false) {
    return Response.json(
      { error: "this dispute is no longer editable — it may already be submitted or closed" },
      { status: 409 },
    );
  }

  try {
    const submitted = await (whopClient() as any).disputes.submitEvidence(disputeId);
    return Response.json({ ok: true, dispute: submitted });
  } catch (err) {
    console.error("[recover] dispute submit error", err);
    return Response.json({ error: "submit failed" }, { status: 500 });
  }
}
