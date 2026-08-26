/**
 * DashboardView — the recovery ROI surface, rendered from cases + alerts.
 *
 * Shared by the demo dashboard (/dashboard) and the Whop-embedded, per-company
 * dashboard (/dashboard/[companyId]). Pure presentation: hand it data, it draws.
 */

import { computeMetrics } from "@/core/revenue";
import { DEFAULT_STEPS, formatAmount } from "@/core/sequences";
import type { Alert, RecoveryCase, Tier } from "@/core/types";
import { ScanPanel } from "./ScanPanel";
import { SettingsPanel } from "./SettingsPanel";
import { UpgradeProButton } from "./UpgradeProButton";

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  recovered: { bg: "#0f2e1c", fg: "#4ade80", label: "Recovered" },
  active: { bg: "#2a2410", fg: "#fbbf24", label: "In progress" },
  lost: { bg: "#2a1315", fg: "#f87171", label: "Lost" },
  cancelled: { bg: "#1b1f27", fg: "#9aa4b2", label: "Cancelled" },
};

const ALERT_STYLE: Record<string, { fg: string; dot: string }> = {
  chargeback: { fg: "#f87171", dot: "#ef4444" },
  refund: { fg: "#fbbf24", dot: "#f59e0b" },
  at_risk: { fg: "#7c9cff", dot: "#6366f1" },
};

const EVIDENCE_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  drafted: { bg: "#0f2e1c", fg: "#4ade80", label: "✓ Evidence auto-drafted" },
  failed: { bg: "#2a1315", fg: "#f87171", label: "Auto-draft failed" },
  not_applicable: { bg: "#1b1f27", fg: "#9aa4b2", label: "Upgrade to Pro for auto-evidence" },
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

export function DashboardView({
  cases,
  alerts,
  tier = "free",
  companyId,
  communityName = "your community",
  customTemplates,
  digestEnabled = true,
  historicalScanAt,
  lastScanResult,
}: {
  cases: RecoveryCase[];
  alerts: Alert[];
  tier?: Tier;
  /** Present on the Whop-embedded dashboard; omitted on the standalone demo. */
  companyId?: string;
  communityName?: string;
  customTemplates?: string[];
  digestEnabled?: boolean;
  historicalScanAt?: string;
  lastScanResult?: { scanned: number; opened: number; skipped: number };
}) {
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/recover-icon.png" alt="Recover" width={34} height={34} />
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
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
            color: tier === "pro" ? "#0b0f14" : "#9aa4b2",
            background: tier === "pro" ? "#4ade80" : "#1b1f27",
            border: tier === "pro" ? "none" : "1px solid #2a3040",
            borderRadius: 999,
            padding: "3px 10px",
          }}
        >
          {tier === "pro" ? "PRO" : "FREE"}
        </span>
        {tier === "free" && companyId ? (
          <UpgradeProButton companyId={companyId} />
        ) : null}
      </div>
      <p style={{ color: "#8b95a5", marginTop: 0, marginBottom: 24 }}>
        Failed payments recovered, members won back, and risks flagged —
        automatically.
      </p>

      {companyId ? (
        <ScanPanel
          companyId={companyId}
          alreadyScannedAt={historicalScanAt}
          initialResult={lastScanResult}
        />
      ) : null}

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
                  {a.kind === "chargeback" && a.evidenceStatus ? (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 999,
                        padding: "2px 8px",
                        background: EVIDENCE_PILL[a.evidenceStatus]?.bg,
                        color: EVIDENCE_PILL[a.evidenceStatus]?.fg,
                      }}
                    >
                      {EVIDENCE_PILL[a.evidenceStatus]?.label}
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

      {companyId ? (
        <SettingsPanel
          companyId={companyId}
          initialCommunityName={communityName}
          initialTemplates={
            customTemplates ?? DEFAULT_STEPS.map((s) => s.template)
          }
          initialDigestEnabled={digestEnabled}
        />
      ) : null}
    </main>
  );
}
