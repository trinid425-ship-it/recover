"use client";

/**
 * Historical scan panel — the "instant value" moment.
 *
 * If the company has never been scanned, it fires the scan automatically on
 * mount so the very first dashboard load surfaces real recovered/at-risk
 * revenue instead of an empty table. After that, it's a manual "Scan again"
 * button (e.g. after reconnecting billing or just to double check).
 */

import { useEffect, useState } from "react";

interface ScanResult {
  scanned: number;
  opened: number;
  skipped: number;
}

export function ScanPanel({
  companyId,
  alreadyScannedAt,
  initialResult,
}: {
  companyId: string;
  alreadyScannedAt?: string;
  initialResult?: ScanResult;
}) {
  const [loading, setLoading] = useState(!alreadyScannedAt);
  const [result, setResult] = useState<ScanResult | null>(initialResult ?? null);
  const [error, setError] = useState<string | null>(null);
  const [scannedAt, setScannedAt] = useState<string | undefined>(alreadyScannedAt);

  async function runScan() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "scan failed");
      setResult({ scanned: data.scanned, opened: data.opened, skipped: data.skipped });
      setScannedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "scan failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!alreadyScannedAt) {
      runScan();
    }
    // Only ever auto-run once, on first mount for a never-scanned company.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        background: result && result.opened > 0 ? "#0f2e1c" : "#121620",
        border: `1px solid ${result && result.opened > 0 ? "#1f4a2e" : "#1e2430"}`,
        borderRadius: 14,
        padding: "14px 18px",
        marginBottom: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div>
        {loading ? (
          <span style={{ color: "#9aa4b2", fontSize: 13 }}>
            🔍 Scanning your existing payments for revenue already worth recovering…
          </span>
        ) : result ? (
          <span style={{ fontSize: 13 }}>
            {result.opened > 0 ? (
              <>
                <span style={{ color: "#4ade80", fontWeight: 600 }}>
                  Found {result.opened} existing failed payment{result.opened === 1 ? "" : "s"}
                </span>
                <span style={{ color: "#9aa4b2" }}>
                  {" "}
                  and started recovering {result.opened === 1 ? "it" : "them"} — out of{" "}
                  {result.scanned} scanned.
                </span>
              </>
            ) : (
              <span style={{ color: "#9aa4b2" }}>
                Scanned {result.scanned} payment{result.scanned === 1 ? "" : "s"} — nothing
                currently failing outside what's already tracked.
              </span>
            )}
          </span>
        ) : error ? (
          <span style={{ color: "#f87171", fontSize: 13 }}>Scan failed: {error}</span>
        ) : null}
        {scannedAt ? (
          <div style={{ color: "#6b7280", fontSize: 11, marginTop: 4 }}>
            Last scanned {new Date(scannedAt).toLocaleString()}
          </div>
        ) : null}
      </div>
      <button
        onClick={runScan}
        disabled={loading}
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: "#e8ebf0",
          background: "transparent",
          border: "1px solid #2a3040",
          borderRadius: 999,
          padding: "5px 12px",
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {loading ? "Scanning…" : "🔍 Scan again"}
      </button>
    </div>
  );
}
