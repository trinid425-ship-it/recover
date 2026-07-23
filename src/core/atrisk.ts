/**
 * At-risk scoring (phase 2).
 *
 * Turns an engagement snapshot into a 0–100 churn-risk score with human
 * reasons. Pure and deterministic so it's fully unit-testable; the data source
 * that produces snapshots (Whop API, product analytics) is wired separately.
 *
 * The weights below are a sensible starting heuristic. Once live data exists,
 * this is the natural place to swap in a fitted model — the interface stays.
 */

import type { EngagementSnapshot, RiskAssessment, RiskBand } from "./types";

function bandFor(score: number): RiskBand {
  if (score >= 65) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function assessRisk(s: EngagementSnapshot): RiskAssessment {
  let score = 0;
  const reasons: string[] = [];

  // 1) Inactivity is the strongest signal.
  if (s.daysSinceLastActive >= 21) {
    score += 45;
    reasons.push(`inactive ${s.daysSinceLastActive} days`);
  } else if (s.daysSinceLastActive >= 14) {
    score += 35;
    reasons.push(`inactive ${s.daysSinceLastActive} days`);
  } else if (s.daysSinceLastActive >= 7) {
    score += 20;
    reasons.push(`quiet for ${s.daysSinceLastActive} days`);
  }

  // 2) Little/no interaction in the last month.
  if (s.messages30d === 0) {
    score += 25;
    reasons.push("no messages in 30 days");
  } else if (s.messages30d <= 2) {
    score += 12;
    reasons.push("very low activity");
  }

  // 3) Renewal imminent while disengaged → prime cancel window.
  if (s.renewalSoon && s.daysSinceLastActive >= 7) {
    score += 20;
    reasons.push("renews soon while disengaged");
  }

  // 4) New members who never really onboarded churn fast.
  if (s.tenureDays <= 14 && s.messages30d <= 2) {
    score += 12;
    reasons.push("never fully onboarded");
  }

  score = Math.max(0, Math.min(100, score));
  if (reasons.length === 0) reasons.push("healthy engagement");

  return {
    membershipId: s.membershipId,
    username: s.username,
    companyId: s.companyId,
    score,
    band: bandFor(score),
    reasons,
    amountCents: s.amountCents,
    currency: s.currency,
  };
}
