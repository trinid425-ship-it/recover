/**
 * Recovery dashboard — the ROI surface a creator sees inside their whop.
 *
 * In production, the installing company id comes from Whop's verified app
 * context (iframe token). For local/demo use we accept ?company=biz_xxx and
 * otherwise aggregate everything in the store.
 */

import { getStore } from "@/lib/runtime";
import { computeMetrics } from "@/core/revenue";
import { formatAmount } from "@/core/sequences";
import type { Alert, RecoveryCase } from "@/core/types";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  recovered: { bg: "#0f2e1c", fg: "#4ade80", label: "Recovered" },
  active: { bg: "#2a2410", fg: "#fbbf24", label: "In progress" },
  lost: { bg: "#2a1315", fg: "#f87171", label: "Lost" },
  cancelled: { bg: "#1b1f27", fg: "#9aa4b2", label: "Cancelled" },
};

const ALERT_STYLE: Record<string, { fg: string; dot: string; label: string }> = {
  chargeback: { fg: "#f87171", dot: "#ef4444", label: "Chargeback" },
  refund: { fg: "#fbbf24", dot: "#f59e0b", label: "Refund" },
  at_risk: { fg: "#7c9cff", dot: "#6366f1", label: "At risk" },
};

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        background: "#121620",
        border: "1px solid #1e2430",
        borderRadius: 14,
        padding: "20px 22px",
        flex: 1,
        minWidth: 170,
      }}
    >
      <div style={{ color: "#8b95a5", fontSize: 13, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: accent ?? "#e8ebf0" }}>
        {value}
      </div>
      {sub ? (
        <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>{sub}</div>
      ) : null}
    </div>
  );
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const { company } = await searchParams;
  const store = getStore();

  let cases: RecoveryCase[];
  let alerts: Alert[];
  if (company) {
    cases = await store.listCasesByCompany(company);
    alerts = await store.listAlertsByCompany(company);
  } else {
    const all = await readAll();
    cases = all.cases;
    alerts = all.alerts;
  }

  const recoveryCases = cases.filter((c) => c.type === "involuntary");
  const winbackCases = cases.filter((c) => c.type === "winback");

  const m = computeMetrics(recoveryCases);
  const recovered = formatAmount(m.recoveredRevenueCents, m.currency);
  const atRisk = formatAmount(m.atRiskRevenueCents, m.currency);
  const rate = m.recoveryRate === null ? "—" : `${Math.round(m.recoveryRate * 100)}%`;
  const winbackActive = winbackCases.filter((c) => c.status === "active").length;
  const openAlerts = alerts.filter((a) => !a.acknowledged);

  const sorted = [...cases].sort(
    (a, b) => Date.parse(b.failedAt) - Date.parse(a.failedAt),
  );

  return (
    <main style={{ padding: "32px 40px", maxWidth: 1040, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700 }}>Recover</span>
        <span
          style={{
            fontSize: 12,
            color: "#7c9cff",
            border: "1px solid #2a3350",
            borderRadius: 999,
            padding: "2px 10px",
          }}
        >
          churn recovery
        </span>
      </div>
      <p style={{ color: "#8b95a5", marginTop: 0, marginBottom: 24 }}>
        Failed payments recovered, members won back, and risks flagged —
        automatically.
      </p>

      {/* Alerts */}
      {openAlerts.length > 0 && (
        <div
          style={{
            background: "#15111a",
            border: "1px solid #3a2733",
            borderRadius: 14,
            padding: "14px 18px",
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, color: "#c98aa6", marginBottom: 10 }}>
            NEEDS ATTENTION · {openAlerts.length}
          </div>
          {openAlerts.map((a) => {
            const s = ALERT_STYLE[a.kind] ?? ALERT_STYLE.at_risk!;
            return (
              <div
                key={a.id}
                style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0" }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: s.dot,
                    display: "inline-block",
                    marginTop: 5,
                  }}
                />
                <div>
                  <span style={{ color: s.fg, fontWeight: 600, fontSize: 14 }}>
                    {a.title}
                  </span>
                  {a.amountCents ? (
                    <span style={{ color: "#e8ebf0", fontSize: 14 }}>
                      {" "}· {formatAmount(a.amountCents, a.currency ?? "usd")}
                    </span>
                  ) : null}
                  <div style={{ color: "#8b95a5", fontSize: 13, marginTop: 2 }}>
                    {a.detail}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat
          label="Revenue recovered"
          value={recovered}
          sub={`${m.recoveredCount} member${m.recoveredCount === 1 ? "" : "s"} saved`}
          accent="#4ade80"
        />
        <Stat label="Recovery rate" value={rate} sub="recovered vs. lost" />
        <Stat
          label="At risk right now"
          value={atRisk}
          sub={`${m.activeCount} in progress`}
          accent="#fbbf24"
        />
        <Stat
          label="Win-backs running"
          value={String(winbackActive)}
          sub="cancelled members being re-engaged"
          accent="#7c9cff"
        />
      </div>

      {/* Cases table */}
      <div
        style={{
          background: "#121620",
          border: "1px solid #1e2430",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr 0.9fr 0.8fr 1fr 0.7fr",
            padding: "12px 18px",
            fontSize: 12,
            color: "#8b95a5",
            borderBottom: "1px solid #1e2430",
          }}
        >
          <div>Member</div>
          <div>Plan</div>
          <div>Type</div>
          <div>Amount</div>
          <div>Status</div>
          <div>Touches</div>
        </div>
        {sorted.length === 0 ? (
          <div style={{ padding: 24, color: "#6b7280" }}>
            No cases yet. When a payment fails or a member cancels, it shows up
            here and the right sequence starts automatically.
          </div>
        ) : (
          sorted.map((c) => {
            const s = STATUS_STYLE[c.status] ?? STATUS_STYLE.cancelled!;
            return (
              <div
                key={c.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.3fr 1fr 0.9fr 0.8fr 1fr 0.7fr",
                  padding: "14px 18px",
                  fontSize: 14,
                  borderBottom: "1px solid #161b26",
                  alignItems: "center",
                }}
              >
                <div>@{c.member.username ?? c.member.userId}</div>
                <div style={{ color: "#9aa4b2" }}>{c.planName}</div>
                <div style={{ color: "#9aa4b2", fontSize: 13 }}>
                  {c.type === "winback" ? "Win-back" : "Recovery"}
                </div>
                <div>{formatAmount(c.amountCents, c.currency)}</div>
                <div>
                  <span
                    style={{
                      background: s.bg,
                      color: s.fg,
                      borderRadius: 999,
                      padding: "3px 10px",
                      fontSize: 12,
                    }}
                  >
                    {s.label}
                  </span>
                </div>
                <div style={{ color: "#9aa4b2" }}>{c.attemptsSent}</div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

// Demo helper: read all cases + alerts straight from the file store.
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
