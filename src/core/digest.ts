/**
 * Weekly digest — the "You saved $X this week" DM sent to the installing
 * company's admin. Pure and deterministic (like revenue.ts) so it's fully
 * unit-testable; the recipient lookup and actual send live in lib/digest.ts.
 */

import { formatAmount } from "./sequences";
import type { RecoveryCase } from "./types";

export interface DigestSummary {
  windowDays: number;
  recoveredCount: number;
  recoveredRevenueCents: number;
  lostCount: number;
  lostRevenueCents: number;
  activeCount: number;
  atRiskRevenueCents: number;
  winbackActiveCount: number;
  currency: string;
}

export function buildWeeklyDigest(
  cases: RecoveryCase[],
  now = new Date(),
  windowDays = 7,
): DigestSummary {
  const windowMs = windowDays * 86_400_000;
  const cutoff = now.getTime() - windowMs;

  let recoveredCount = 0;
  let recoveredRevenueCents = 0;
  let lostCount = 0;
  let lostRevenueCents = 0;
  let activeCount = 0;
  let atRiskRevenueCents = 0;
  let winbackActiveCount = 0;
  let currency = "usd";

  for (const c of cases) {
    currency = c.currency || currency;

    if (c.status === "recovered" && c.recoveredAt && Date.parse(c.recoveredAt) >= cutoff) {
      recoveredCount += 1;
      recoveredRevenueCents += c.amountCents;
    }
    if (c.status === "lost" && c.lostAt && Date.parse(c.lostAt) >= cutoff) {
      lostCount += 1;
      lostRevenueCents += c.amountCents;
    }
    // Active counts are a current snapshot, not windowed — "here's what's
    // in flight right now", same as the dashboard's own stat cards.
    if (c.status === "active") {
      if (c.type === "involuntary") {
        activeCount += 1;
        atRiskRevenueCents += c.amountCents;
      } else {
        winbackActiveCount += 1;
      }
    }
  }

  return {
    windowDays,
    recoveredCount,
    recoveredRevenueCents,
    lostCount,
    lostRevenueCents,
    activeCount,
    atRiskRevenueCents,
    winbackActiveCount,
    currency,
  };
}

/** True when a digest is worth sending — skip silent weeks so the DM stays a signal, not noise. */
export function hasDigestActivity(s: DigestSummary): boolean {
  return (
    s.recoveredCount > 0 ||
    s.lostCount > 0 ||
    s.activeCount > 0 ||
    s.winbackActiveCount > 0
  );
}

export function renderDigestMessage(communityName: string, s: DigestSummary): string {
  const lines: string[] = [
    `Your Recover digest for ${communityName} — last ${s.windowDays} days:`,
    "",
    `💰 Recovered: ${formatAmount(s.recoveredRevenueCents, s.currency)} (${s.recoveredCount} member${s.recoveredCount === 1 ? "" : "s"})`,
  ];

  if (s.lostCount > 0) {
    lines.push(
      `⚠️ Lost: ${formatAmount(s.lostRevenueCents, s.currency)} (${s.lostCount} member${s.lostCount === 1 ? "" : "s"})`,
    );
  }
  if (s.activeCount > 0) {
    lines.push(
      `🔄 In progress: ${formatAmount(s.atRiskRevenueCents, s.currency)} across ${s.activeCount} member${s.activeCount === 1 ? "" : "s"}`,
    );
  }
  if (s.winbackActiveCount > 0) {
    lines.push(`👋 Win-backs running: ${s.winbackActiveCount}`);
  }

  lines.push("", "Open the Recover dashboard for the full breakdown.");
  return lines.join("\n");
}
