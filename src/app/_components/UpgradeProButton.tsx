"use client";

/**
 * "Upgrade to Pro" button — hits /api/checkout/pro for a purchase URL, then
 * opens it in a new tab. A plain link avoids pulling in @whop/react's iframe
 * SDK provider just for one button; opening in a new tab keeps the dashboard
 * iframe itself from having to navigate away mid-payment.
 */

import { useState } from "react";

export function UpgradeProButton({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/pro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? "checkout failed");
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "checkout failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: "#0b0f14",
          background: "#4ade80",
          border: "none",
          borderRadius: 999,
          padding: "3px 10px",
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "Opening checkout…" : "Upgrade to Pro"}
      </button>
      {error ? (
        <span style={{ fontSize: 11, color: "#f87171" }}>{error}</span>
      ) : null}
    </div>
  );
}
