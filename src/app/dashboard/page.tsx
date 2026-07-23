/**
 * Demo / standalone dashboard at /dashboard.
 *
 * Aggregates every case + alert in the store (handy for local dev and a quick
 * look outside Whop). The real, per-creator view lives at /dashboard/[companyId]
 * and is gated by Whop auth.
 */

import { DashboardView } from "@/app/_components/DashboardView";
import type { Alert, RecoveryCase } from "@/core/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const { cases, alerts } = await readAll();
  return <DashboardView cases={cases} alerts={alerts} />;
}

async function readAll(): Promise<{ cases: RecoveryCase[]; alerts: Alert[] }> {
  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const raw = await fs.readFile(
      path.join(process.cwd(), "data", "recover-db.json"),
      "utf8",
    );
    const db = JSON.parse(raw) as {
      cases: Record<string, RecoveryCase>;
      alerts: Record<string, Alert>;
    };
    return {
      cases: Object.values(db.cases ?? {}),
      alerts: Object.values(db.alerts ?? {}),
    };
  } catch {
    return { cases: [], alerts: [] };
  }
}
