/**
 * Pure mapping logic for the historical backfill scan — kept separate from
 * backfill.ts (which touches the network) so it's fully unit-testable, same
 * split as mapping.ts (pure) vs whop.ts (network client).
 *
 * A Whop `/payments` list item represents a currently-open, already-retried
 * charge the same way a `payment.failed` webhook does — this turns one into
 * the same normalized EngineEvent the webhook path produces, so backfilled
 * cases behave identically to ones opened live (idempotent, same dunning
 * sequence, same dashboard row).
 */

import type { EngineEvent } from "../core/types";
import { pick, toCents } from "./mapping";

export type AnyRecord = Record<string, any>;

/**
 * True when a payment from `/payments` represents a real, already-failing
 * charge worth opening a recovery case for: it's still open (unpaid) and has
 * at least one failed attempt or an explicit failure/decline reason.
 */
export function isBackfillCandidate(p: AnyRecord): boolean {
  const status = pick<string>(p, "status");
  if (status !== "open") return false;
  const attempts = Number(p?.payments_failed ?? 0);
  const hasFailureSignal =
    attempts > 0 || !!p?.failure_message || !!p?.decline_code;
  return hasFailureSignal;
}

/**
 * Maps one `/payments` list item into the same `payment_failed` EngineEvent
 * shape the live webhook produces. Returns null when required identity
 * fields (membership, user) are missing — mirrors mapWebhook's behavior of
 * dropping events it can't act on rather than throwing.
 */
export function mapPaymentToFailedEvent(
  companyId: string,
  p: AnyRecord,
): EngineEvent | null {
  const membershipId = pick<string>(p, "membership.id", "membership_id");
  const userId = pick<string>(p, "user.id", "user_id");
  if (!membershipId || !userId) return null;

  const occurredAt =
    pick<string>(p, "last_payment_attempt", "created_at") ??
    new Date().toISOString();

  return {
    kind: "payment_failed",
    // Stable, deterministic id so re-running the scan is a no-op (the
    // engine's own idempotency check on appliedEventIds handles the rest).
    eventId: `backfill_${pick<string>(p, "id") ?? `${membershipId}_${occurredAt}`}`,
    companyId,
    member: {
      membershipId,
      userId,
      username: pick<string>(p, "user.username"),
    },
    amountCents: toCents(pick(p, "total", "subtotal") ?? 0),
    currency: (pick<string>(p, "currency") ?? "usd").toLowerCase(),
    // Payments don't carry a plan title the way webhooks do — the product
    // title is the closest stable label, same fallback mapWebhook uses.
    planName: pick<string>(p, "product.title", "plan.title") ?? "membership",
    occurredAt,
  };
}
