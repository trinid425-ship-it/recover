"use client";

/**
 * White-label + digest settings — lets the installing creator make the DM
 * copy sound like their own community instead of a generic bot, and opt
 * in/out of the weekly "revenue saved" digest DM.
 */

import { useState } from "react";

const STEP_LABELS = ["Touch 1 — immediate", "Touch 2 — +48h", "Touch 3 — +96h", "Touch 4 — final, +168h"];

export function SettingsPanel({
  companyId,
  initialCommunityName,
  initialTemplates,
  initialDigestEnabled,
}: {
  companyId: string;
  initialCommunityName: string;
  initialTemplates: string[];
  initialDigestEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [communityName, setCommunityName] = useState(initialCommunityName);
  const [templates, setTemplates] = useState<string[]>(initialTemplates);
  const [digestEnabled, setDigestEnabled] = useState(initialDigestEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, communityName, customTemplates: templates, digestEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save failed");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        background: "#121620",
        border: "1px solid #1e2430",
        borderRadius: 14,
        marginTop: 14,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          color: "#e8ebf0",
          padding: "14px 18px",
          fontSize: 14,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>⚙️ White-label messages &amp; digest settings</span>
        <span style={{ color: "#6b7280" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div style={{ padding: "0 18px 18px" }}>
          <label style={{ display: "block", fontSize: 12, color: "#8b95a5", marginBottom: 6 }}>
            Community name (used in every DM, e.g. "your spot in {"{community}"}")
          </label>
          <input
            value={communityName}
            onChange={(e) => setCommunityName(e.target.value)}
            style={{
              width: "100%",
              background: "#0b0e14",
              border: "1px solid #2a3040",
              borderRadius: 8,
              color: "#e8ebf0",
              padding: "8px 10px",
              fontSize: 13,
              marginBottom: 16,
              boxSizing: "border-box",
            }}
          />

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "#e8ebf0",
              marginBottom: 16,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => setDigestEnabled(e.target.checked)}
            />
            Send me a weekly "revenue saved" digest DM
          </label>

          <div style={{ fontSize: 12, color: "#8b95a5", marginBottom: 8 }}>
            Dunning message copy — override the default wording per touch. Leave a box empty to
            use Recover's default for that step. Variables: {"{username} {amount} {plan} {community} {updateUrl}"}
          </div>
          {STEP_LABELS.map((label, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <label style={{ display: "block", fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
                {label}
              </label>
              <textarea
                value={templates[i] ?? ""}
                onChange={(e) => {
                  const next = [...templates];
                  next[i] = e.target.value;
                  setTemplates(next);
                }}
                rows={2}
                style={{
                  width: "100%",
                  background: "#0b0e14",
                  border: "1px solid #2a3040",
                  borderRadius: 8,
                  color: "#e8ebf0",
                  padding: "8px 10px",
                  fontSize: 12,
                  fontFamily: "inherit",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: "#0b0f14",
                background: "#4ade80",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                cursor: saving ? "default" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
            {saved ? <span style={{ color: "#4ade80", fontSize: 12 }}>Saved ✓</span> : null}
            {error ? <span style={{ color: "#f87171", fontSize: 12 }}>{error}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
