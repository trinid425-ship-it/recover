/**
 * Recover — domain types.
 *
 * A "RecoveryCase" is the unit of work: one member whose payment failed, that
 * we are actively trying to win back before their membership lapses for good.
 */

export type RecoveryStatus =
  | "active" // a payment failed; we are working the dunning sequence
  | "recovered" // member updated their card / paid — churn prevented
  | "lost" // sequence exhausted, membership gone — churn happened
  | "cancelled"; // creator disabled recovery or member intentionally cancelled

/**
 * Why a case exists:
 *  - "involuntary": a payment failed (expired/insufficient card). Dunning flow.
 *  - "winback": the member cancelled cleanly with no failed payment. A softer
 *    win-back sequence with a resubscribe offer.
 * Both share the same case machinery; only the trigger and copy differ.
 */
export type CaseType = "involuntary" | "winback";

/** Minimal identity of a member, pulled from the webhook payload. */
export interface MemberRef {
  membershipId: string;
  userId: string;
  username?: string;
  /** DM channel to message this user; may be resolved lazily. */
  dmChannelId?: string;
}

/** A single outbound message we sent while working a case. */
export interface SentMessage {
  stepIndex: number;
  sentAt: string; // ISO
  channelId: string;
  messageId: string;
  preview: string; // first ~80 chars, for the dashboard log
}

export interface RecoveryCase {
  id: string; // stable id, derived from companyId + membershipId
  companyId: string; // the whop that installed us
  type: CaseType; // involuntary (dunning) or winback
  member: MemberRef;

  amountCents: number; // value of the failed charge
  currency: string; // e.g. "usd"
  planName: string; // human label for the dashboard

  status: RecoveryStatus;
  failedAt: string; // ISO — when the first payment failure happened
  recoveredAt?: string; // ISO
  lostAt?: string; // ISO

  attemptsSent: number; // how many dunning steps have gone out
  nextActionAt: string | null; // ISO — when the next step is due (null = nothing scheduled)

  updateUrl: string; // deep link the member uses to fix their payment method
  messageLog: SentMessage[];

  /** Dedup keys for webhook events we've already applied (idempotency). */
  appliedEventIds: string[];
}

/** Per-company configuration, editable by the creator in the dashboard. */
export interface CompanyConfig {
  companyId: string;
  enabled: boolean;
  communityName: string; // used in message copy, e.g. "Alpha Trades"
  /** Optional overrides for the dunning cadence (hours after failure). */
  stepOffsetsHours?: number[];
  /** Optional custom copy per step; falls back to defaults. */
  customTemplates?: string[];
}

/** Normalized inbound event the engine understands (mapped from Whop webhooks). */
export type EngineEvent =
  | {
      kind: "payment_failed";
      eventId: string;
      companyId: string;
      member: MemberRef;
      amountCents: number;
      currency: string;
      planName: string;
      occurredAt: string;
    }
  | {
      kind: "payment_succeeded";
      eventId: string;
      companyId: string;
      membershipId: string;
      amountCents: number;
      occurredAt: string;
    }
  | {
      kind: "membership_deactivated";
      eventId: string;
      companyId: string;
      membershipId: string;
      occurredAt: string;
      /** Member + charge context, present when Whop includes it — needed to
       *  open a win-back case for a clean cancellation. */
      member?: MemberRef;
      amountCents?: number;
      currency?: string;
      planName?: string;
      /** True when the member cancelled on purpose (not a payment failure). */
      voluntary?: boolean;
    }
  | {
      kind: "dispute_created"; // buyer opened a chargeback
      eventId: string;
      companyId: string;
      membershipId?: string;
      userId?: string;
      username?: string;
      amountCents: number;
      currency: string;
      occurredAt: string;
    }
  | {
      kind: "refund_created";
      eventId: string;
      companyId: string;
      membershipId?: string;
      username?: string;
      amountCents: number;
      currency: string;
      occurredAt: string;
    };

// ── Alerts ─────────────────────────────────────────────────────────────────
// Creator-facing notifications (chargebacks, refunds, at-risk spikes) that
// don't fit the member-DM flow. Surfaced on the dashboard.

export type AlertKind = "chargeback" | "refund" | "at_risk";
export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  companyId: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  amountCents?: number;
  currency?: string;
  createdAt: string; // ISO
  acknowledged: boolean;
}

// ── At-risk detection ────────────────────────────────────────────────────────
// A point-in-time snapshot of a member's engagement, from which we derive a
// churn-risk score. The snapshot source is pluggable (Whop API, analytics, etc).

export interface EngagementSnapshot {
  membershipId: string;
  userId: string;
  username?: string;
  companyId: string;
  /** Days since the member last did anything (opened, chatted, watched). */
  daysSinceLastActive: number;
  /** Messages/interactions in the trailing 30 days. */
  messages30d: number;
  /** Days the member has been subscribed. */
  tenureDays: number;
  /** True if their renewal is within the next 7 days. */
  renewalSoon: boolean;
  amountCents: number;
  currency: string;
}

export type RiskBand = "low" | "medium" | "high";

export interface RiskAssessment {
  membershipId: string;
  username?: string;
  companyId: string;
  score: number; // 0..100, higher = more likely to churn
  band: RiskBand;
  reasons: string[];
  amountCents: number;
  currency: string;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
