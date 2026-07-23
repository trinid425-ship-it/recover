/**
 * Map a verified Whop webhook payload into our normalized EngineEvent.
 *
 * Whop webhook envelope: { type: string, data: {...} }. Field names below
 * follow the documented payment/membership resources; the mapper is defensive
 * about optional fields so a schema tweak won't crash the pipeline.
 *
 * We deliberately handle only the three events the recovery engine needs:
 *   payment.failed, payment.succeeded, membership.deactivated
 */

import type { EngineEvent } from "../core/types.js";

type AnyRecord = Record<string, any>;

function pick<T = string>(obj: AnyRecord, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = k.split(".").reduce<any>((o, part) => (o == null ? o : o[part]), obj);
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

function toCents(amount: unknown): number {
  if (typeof amount === "number") {
    // Whop amounts may be decimal dollars; normalize to integer cents.
    return Number.isInteger(amount) && amount > 1000
      ? amount // already cents
      : Math.round(amount * 100);
  }
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function mapWebhook(
  type: string,
  data: AnyRecord,
): EngineEvent | null {
  const eventId =
    pick<string>(data, "id", "receipt_id", "payment_id") ??
    `${type}_${Date.now()}`;
  const companyId =
    pick<string>(data, "company_id", "company.id", "biz_id") ?? "";
  const occurredAt =
    pick<string>(data, "created_at", "occurred_at") ?? new Date().toISOString();

  if (!companyId) return null;

  switch (type) {
    case "payment.failed":
    case "payment_failed": {
      const membershipId = pick<string>(
        data,
        "membership_id",
        "membership.id",
        "membership",
      );
      const userId = pick<string>(data, "user_id", "user.id", "user");
      if (!membershipId || !userId) return null;
      return {
        kind: "payment_failed",
        eventId,
        companyId,
        member: {
          membershipId,
          userId,
          username: pick<string>(data, "user.username", "username"),
        },
        amountCents: toCents(pick(data, "final_amount", "amount", "subtotal")),
        currency: (pick<string>(data, "currency") ?? "usd").toLowerCase(),
        planName:
          pick<string>(data, "plan.name", "plan_name", "product.title") ??
          "membership",
        occurredAt,
      };
    }

    case "payment.succeeded":
    case "payment_succeeded": {
      const membershipId = pick<string>(
        data,
        "membership_id",
        "membership.id",
        "membership",
      );
      if (!membershipId) return null;
      return {
        kind: "payment_succeeded",
        eventId,
        companyId,
        membershipId,
        amountCents: toCents(pick(data, "final_amount", "amount", "subtotal")),
        occurredAt,
      };
    }

    case "membership.deactivated":
    case "membership_deactivated": {
      const membershipId = pick<string>(data, "id", "membership_id");
      if (!membershipId) return null;
      const userId = pick<string>(data, "user_id", "user.id", "user");
      const reason = (
        pick<string>(data, "cancellation_reason", "reason", "status_reason") ??
        ""
      ).toLowerCase();
      // If the reason points at a payment problem, it's involuntary; otherwise
      // treat as a voluntary cancellation eligible for win-back.
      const voluntary = reason
        ? !/payment|charge|card|declin|fail|dunning/.test(reason)
        : undefined;
      return {
        kind: "membership_deactivated",
        eventId,
        companyId,
        membershipId,
        occurredAt,
        voluntary,
        member: userId
          ? {
              membershipId,
              userId,
              username: pick<string>(data, "user.username", "username"),
            }
          : undefined,
        amountCents: toCents(pick(data, "renewal_price", "amount", "plan.renewal_price")),
        currency: (pick<string>(data, "currency") ?? "usd").toLowerCase(),
        planName:
          pick<string>(data, "plan.name", "plan_name", "product.title") ??
          "membership",
      };
    }

    case "dispute.created":
    case "dispute_created": {
      return {
        kind: "dispute_created",
        eventId,
        companyId,
        membershipId: pick<string>(data, "membership_id", "membership.id"),
        userId: pick<string>(data, "user_id", "user.id"),
        username: pick<string>(data, "user.username", "username"),
        amountCents: toCents(pick(data, "amount", "disputed_amount", "final_amount")),
        currency: (pick<string>(data, "currency") ?? "usd").toLowerCase(),
        occurredAt,
      };
    }

    case "refund.created":
    case "refund_created": {
      return {
        kind: "refund_created",
        eventId,
        companyId,
        membershipId: pick<string>(data, "membership_id", "membership.id"),
        username: pick<string>(data, "user.username", "username"),
        amountCents: toCents(pick(data, "amount", "refunded_amount", "final_amount")),
        currency: (pick<string>(data, "currency") ?? "usd").toLowerCase(),
        occurredAt,
      };
    }

    default:
      return null;
  }
}
