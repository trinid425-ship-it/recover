/**
 * Read/update a company's Recover config — community name, custom message
 * templates (the "white-labeled" DM copy), and the weekly digest toggle.
 * Admin-gated, same pattern as /api/checkout/pro and /api/scan.
 */

import type { NextRequest } from "next/server";
import { DEFAULT_STEPS } from "@/core/sequences";
import { accessLevel, verifyWhopViewer } from "@/lib/auth";
import { getStore } from "@/lib/runtime";

async function requireAdmin(companyId: string | undefined) {
  const viewer = await verifyWhopViewer();
  if (!viewer) return { ok: false as const, status: 401, error: "unauthenticated" };
  if (!companyId) return { ok: false as const, status: 400, error: "missing companyId" };
  const level = await accessLevel(viewer.userId, companyId);
  if (level !== "admin") return { ok: false as const, status: 403, error: "admins only" };
  return { ok: true as const, viewer };
}

export async function GET(request: NextRequest): Promise<Response> {
  const companyId = new URL(request.url).searchParams.get("companyId") ?? undefined;
  const gate = await requireAdmin(companyId);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  const cfg = await getStore().getConfig(companyId!);
  return Response.json({
    communityName: cfg?.communityName ?? "your community",
    customTemplates: cfg?.customTemplates ?? DEFAULT_STEPS.map((s) => s.template),
    digestEnabled: cfg?.digestEnabled ?? true,
    tier: cfg?.tier ?? "free",
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const companyId = typeof body?.companyId === "string" ? body.companyId : undefined;
  const gate = await requireAdmin(companyId);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  const communityName =
    typeof body?.communityName === "string" && body.communityName.trim()
      ? body.communityName.trim().slice(0, 80)
      : "your community";

  // Always save a full-length array — one entry per default step, blanks
  // replaced with that step's default copy. resolveSteps() sizes the
  // sequence off whichever of stepOffsetsHours/customTemplates is present,
  // so a short array here would silently truncate the whole dunning
  // sequence instead of just "using the default" for the blank steps.
  const customTemplates: string[] | undefined = Array.isArray(body?.customTemplates)
    ? DEFAULT_STEPS.map((step, i) => {
        const raw = body.customTemplates[i];
        const trimmed = typeof raw === "string" ? raw.trim() : "";
        return trimmed ? trimmed.slice(0, 600) : step.template;
      })
    : undefined;

  const digestEnabled = body?.digestEnabled !== false;

  const store = getStore();
  const existing = await store.getConfig(companyId!);
  await store.saveConfig({
    companyId: companyId!,
    enabled: true,
    ...existing,
    communityName,
    customTemplates,
    digestEnabled,
  });

  return Response.json({ ok: true });
}
