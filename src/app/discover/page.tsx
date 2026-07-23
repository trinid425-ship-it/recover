/**
 * Public discover / preview page: /discover.
 *
 * A creator browsing the Whop App Store sees this before installing. No auth —
 * it's a marketing surface. Keeps the same brand as the app.
 */

export const dynamic = "force-static";

const POINTS: Array<[string, string]> = [
  ["Recover failed payments", "Auto-DMs members a one-tap link to fix an expired or declined card before they churn."],
  ["Win back cancellations", "Sends a softer, offer-led sequence to members who cancel."],
  ["Catch risks early", "Flags chargebacks, refunds, and at-risk members before they cost you."],
  ["See what you saved", "One dashboard, one number: revenue saved this month."],
];

export default function Discover() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/recover-icon.png" alt="Recover" width={56} height={56} />
        <h1 style={{ fontSize: 30, margin: 0 }}>Recover</h1>
      </div>
      <p style={{ color: "#9aa4b2", fontSize: 18, lineHeight: 1.6, marginTop: 4 }}>
        Turn failed payments into recovered revenue — automatically. The
        money-saving layer for your Whop community.
      </p>

      <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
        {POINTS.map(([title, body]) => (
          <div
            key={title}
            style={{
              background: "#121620",
              border: "1px solid #1e2430",
              borderRadius: 14,
              padding: "18px 20px",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
            <div style={{ color: "#9aa4b2", lineHeight: 1.6 }}>{body}</div>
          </div>
        ))}
      </div>

      <p style={{ color: "#6b7280", fontSize: 13, marginTop: 28 }}>
        Every subscription community leaks revenue to failed payments — often
        20–40% of churn, and most of it is preventable. Recover gets it back.
      </p>
    </main>
  );
}
