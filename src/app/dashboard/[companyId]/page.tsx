/**
 * Whop-embedded creator dashboard: /dashboard/[companyId].
 *
 * Whop routes an installing creator's iframe here with their companyId in the
 * path and an `x-whop-user-token` header. We verify the token, confirm the
 * viewer is an admin of that company, then show only that company's recovery
 * data. Anyone without an admin token sees a gentle notice instead of data.
 */

import { DashboardView } from "@/app/_components/DashboardView";
import { accessLevel, verifyWhopViewer } from "@/lib/auth";
import { cachedTier, syncProTier } from "@/lib/plan";
import { getStore } from "@/lib/runtime";

export const dynamic = "force-dynamic";

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main style={{ padding: 40, maxWidth: 520, margin: "10vh auto", textAlign: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/recover-icon.png" alt="Recover" width={72} height={72} />
      <h1 style={{ fontSize: 22, marginTop: 16 }}>{title}</h1>
      <p style={{ color: "#9aa4b2", lineHeight: 1.6 }}>{body}</p>
    </main>
  );
}

export default async function CompanyDashboard({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;

  const viewer = await verifyWhopViewer();
  if (!viewer) {
    return (
      <Notice
        title="Open Recover inside Whop"
        body="This dashboard loads inside your whop. Open the Recover app from your Whop dashboard to view your recovered revenue."
      />
    );
  }

  const level = await accessLevel(viewer.userId, companyId);
  if (level !== "admin") {
    return (
      <Notice
        title="Admins only"
        body="Recover's revenue dashboard is available to the community owner and team. Ask an admin for access."
      />
    );
  }

  const store = getStore();
  const [cases, alerts, tier] = await Promise.all([
    store.listCasesByCompany(companyId),
    store.listAlertsByCompany(companyId),
    syncProTier(store, companyId).catch(() => cachedTier(store, companyId)),
  ]);

  return <DashboardView cases={cases} alerts={alerts} tier={tier} />;
}
