/**
 * Starts a Recover Pro checkout for the calling company.
 *
 * Admin-gated: only a team member/owner of the company being upgraded can
 * start this. Creates a checkout configuration tagged with
 * metadata.installing_company_id and hands back its purchase URL — the
 * dashboard opens it in a new tab so the iframe never has to navigate away
 * from Whop mid-payment.
 */

import type { NextRequest } from "next/server";
import { accessLevel, verifyWhopViewer } from "@/lib/auth";
import { createProCheckout } from "@/lib/pro-checkout";

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
    const appBaseUrl = process.env.APP_BASE_URL ?? "https://recover-itho.vercel.app";
    const redirectUrl = `${appBaseUrl}/dashboard/${companyId}`;
    const checkout = await createProCheckout(companyId, redirectUrl);
    return Response.json({ url: checkout.purchaseUrl });
  } catch (err) {
    console.error("[recover] pro checkout error", err);
    return Response.json({ error: "checkout failed" }, { status: 500 });
  }
}
