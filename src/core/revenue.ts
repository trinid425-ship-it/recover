/**
 * Revenue / ROI metrics derived from recovery cases.
 *
 * This is the number that sells the product: "Recover saved you $X this month."
 * We compute it straight from case state so it is always defensible.
 */

import type { RecoveryCase } from "./types.js";

export interface RecoveryMetrics {
  recoveredCount: number;
  lostCount: number;
  activeCount: number;
  /** Sum of failed charges we successfully recovered (cents). */
  recoveredRevenueCents: number;
  /** Sum of charges still in-flight / being worked (cents). */
  atRiskRevenueCents: number;
  /** Sum of charges we ultimately lost (cents). */
  lostRevenueCents: number;
  /** recovered / (recovered + lost); null until there's a resolved case. */
  recoveryRate: number | null;
  currency: string;
}

export function computeMetrics(
  cases: RecoveryCase[],
  currency = "usd",
): RecoveryMetrics {
  let recoveredCount = 0;
  let lostCount = 0;
  let activeCount = 0;
  let recoveredRevenueCents = 0;
  let atRiskRevenueCents = 0;
  let lostRevenueCents = 0;
  let resolvedCurrency = currency;

  for (const c of cases) {
    resolvedCurrency = c.currency || resolvedCurrency;
    switch (c.status) {
      case "recovered":
        recoveredCount += 1;
        recoveredRevenueCents += c.amountCents;
        break;
      case "lost":
        lostCount += 1;
        lostRevenueCents += c.amountCents;
        break;
      case "active":
        activeCount += 1;
        atRiskRevenueCents += c.amountCents;
        break;
      default:
        break;
    }
  }

  const resolved = recoveredCount + lostCount;
  const recoveryRate = resolved === 0 ? null : recoveredCount / resolved;

  return {
    recoveredCount,
    lostCount,
    activeCount,
    recoveredRevenueCents,
    atRiskRevenueCents,
    lostRevenueCents,
    recoveryRate,
    currency: resolvedCurrency,
  };
}
