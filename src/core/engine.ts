/**
 * RecoveryEngine — the core state machine.
 *
 * It consumes normalized Whop events and drives each RecoveryCase through its
 * lifecycle:
 *
 *   payment_failed ─▶ [active] ──(dunning steps over 7 days)──▶ ...
 *        ▲                │
 *        │                ├─ payment_succeeded  ─▶ [recovered]  (churn prevented)
 *        │                ├─ steps exhausted     ─▶ [lost]      (churn happened)
 *        └────────────────┴─ membership_deactivated after final step ─▶ [lost]
 *
 * All side effects (storage, messaging, time) are injected, so the engine is
 * deterministic and fully unit-testable.
 */

import type { DraftInput, EvidenceDrafter } from "./evidence";
import { MockMessenger, type Messenger } from "./messaging";
import { caseId, InMemoryStore, type RecoveryStore } from "./store";
import {
  renderTemplate,
  stepsForType,
  type SequenceStep,
} from "./sequences";
import { assessRisk } from "./atrisk";
import {
  systemClock,
  type Alert,
  type CaseType,
  type Clock,
  type CompanyConfig,
  type EngagementSnapshot,
  type EngineEvent,
  type RecoveryCase,
  type RiskAssessment,
  type Tier,
} from "./types";

export interface EngineDeps {
  store: RecoveryStore;
  messenger: Messenger;
  clock?: Clock;
  /** Base URL used to build the member's "update payment method" link. */
  appBaseUrl?: string;
  /** Recover Pro: drafts dispute evidence automatically. Omit to disable. */
  evidenceDrafter?: EvidenceDrafter;
}

export interface HandleResult {
  applied: boolean;
  caseId?: string;
  action?:
    | "opened"
    | "winback_opened"
    | "recovered"
    | "lost"
    | "alert_created"
    | "duplicate_ignored"
    | "no_case"
    | "step_sent"
    | "evidence_retro_drafted"
    | "noop";
  alertId?: string;
}

export class RecoveryEngine {
  /** Hours after the final dunning step before an unpaid case is marked lost. */
  static readonly GRACE_HOURS = 48;

  private store: RecoveryStore;
  private messenger: Messenger;
  private clock: Clock;
  private appBaseUrl: string;
  private evidenceDrafter?: EvidenceDrafter;

  constructor(deps: EngineDeps) {
    this.store = deps.store;
    this.messenger = deps.messenger;
    this.clock = deps.clock ?? systemClock;
    this.appBaseUrl = deps.appBaseUrl ?? "https://whop.com";
    this.evidenceDrafter = deps.evidenceDrafter;
  }

  /** Entry point for a normalized inbound event. */
  async handle(evt: EngineEvent): Promise<HandleResult> {
    switch (evt.kind) {
      case "payment_failed":
        return this.onPaymentFailed(evt);
      case "payment_succeeded":
        return this.onPaymentSucceeded(evt);
      case "membership_deactivated":
        return this.onMembershipDeactivated(evt);
      case "dispute_created":
        return this.onDisputeCreated(evt);
      case "refund_created":
        return this.onRefundCreated(evt);
      case "pro_tier_confirmed":
        return this.onProTierConfirmed(evt);
    }
  }

  private async config(companyId: string): Promise<CompanyConfig | null> {
    return this.store.getConfig(companyId);
  }

  private buildUpdateUrl(c: {
    companyId: string;
    membershipId: string;
    action: "update" | "resubscribe";
  }): string {
    // Deep link that lands the member on Whop's billing/update-card flow (or a
    // resubscribe offer), routed through our app so we can attribute recovery.
    const u = new URL("/r", this.appBaseUrl);
    u.searchParams.set("c", c.companyId);
    u.searchParams.set("m", c.membershipId);
    u.searchParams.set("a", c.action);
    return u.toString();
  }

  private async onPaymentFailed(
    evt: Extract<EngineEvent, { kind: "payment_failed" }>,
  ): Promise<HandleResult> {
    const cfg = await this.config(evt.companyId);
    if (cfg && cfg.enabled === false) {
      return { applied: false, action: "noop" };
    }

    const id = caseId(evt.companyId, evt.member.membershipId);
    let c = await this.store.getCase(id);

    // Idempotency: never double-apply the same webhook.
    if (c && c.appliedEventIds.includes(evt.eventId)) {
      return { applied: false, caseId: id, action: "duplicate_ignored" };
    }

    // If a case is already active for this membership, just record the event —
    // repeated retries of the same failed sub shouldn't restart the sequence.
    if (c && c.status === "active") {
      c.appliedEventIds.push(evt.eventId);
      await this.store.saveCase(c);
      return { applied: true, caseId: id, action: "noop" };
    }

    const steps = stepsForType("involuntary", cfg);
    c = {
      id,
      companyId: evt.companyId,
      type: "involuntary",
      member: evt.member,
      amountCents: evt.amountCents,
      currency: evt.currency,
      planName: evt.planName,
      status: "active",
      failedAt: evt.occurredAt,
      attemptsSent: 0,
      nextActionAt: evt.occurredAt, // first touch is due immediately
      updateUrl: this.buildUpdateUrl({
        companyId: evt.companyId,
        membershipId: evt.member.membershipId,
        action: "update",
      }),
      messageLog: [],
      appliedEventIds: [evt.eventId],
    };
    await this.store.saveCase(c);

    // Fire the first dunning step right away.
    await this.sendNextStep(c, steps, cfg);
    return { applied: true, caseId: id, action: "opened" };
  }

  private async onPaymentSucceeded(
    evt: Extract<EngineEvent, { kind: "payment_succeeded" }>,
  ): Promise<HandleResult> {
    const id = caseId(evt.companyId, evt.membershipId);
    const c = await this.store.getCase(id);
    if (!c || c.status !== "active") {
      return { applied: false, caseId: id, action: "no_case" };
    }
    if (c.appliedEventIds.includes(evt.eventId)) {
      return { applied: false, caseId: id, action: "duplicate_ignored" };
    }

    c.status = "recovered";
    c.recoveredAt = evt.occurredAt;
    c.nextActionAt = null;
    c.appliedEventIds.push(evt.eventId);
    await this.store.saveCase(c);
    return { applied: true, caseId: id, action: "recovered" };
  }

  private async onMembershipDeactivated(
    evt: Extract<EngineEvent, { kind: "membership_deactivated" }>,
  ): Promise<HandleResult> {
    const id = caseId(evt.companyId, evt.membershipId);
    const c = await this.store.getCase(id);

    // Case A: an involuntary recovery was in progress → the membership lapsed,
    // so we lost it.
    if (c && c.status === "active") {
      if (c.appliedEventIds.includes(evt.eventId)) {
        return { applied: false, caseId: id, action: "duplicate_ignored" };
      }
      c.status = "lost";
      c.lostAt = evt.occurredAt;
      c.nextActionAt = null;
      c.appliedEventIds.push(evt.eventId);
      await this.store.saveCase(c);
      return { applied: true, caseId: id, action: "lost" };
    }

    // Case B: a clean cancellation (no failed payment, no existing case) and we
    // have enough member context → open a win-back sequence.
    const cfg = await this.config(evt.companyId);
    const winbackEnabled = !cfg || cfg.enabled !== false;
    if (!c && winbackEnabled && evt.member && evt.voluntary !== false) {
      return this.openWinback(evt);
    }

    return { applied: false, caseId: id, action: "no_case" };
  }

  private async openWinback(
    evt: Extract<EngineEvent, { kind: "membership_deactivated" }>,
  ): Promise<HandleResult> {
    const member = evt.member!;
    const id = caseId(evt.companyId, member.membershipId);
    const cfg = await this.config(evt.companyId);
    const steps = stepsForType("winback", cfg);

    const c: RecoveryCase = {
      id,
      companyId: evt.companyId,
      type: "winback",
      member,
      amountCents: evt.amountCents ?? 0,
      currency: evt.currency ?? "usd",
      planName: evt.planName ?? "membership",
      status: "active",
      failedAt: evt.occurredAt, // reuse as "cancelled at" anchor for scheduling
      attemptsSent: 0,
      // Win-back's first touch waits (first step offset), so schedule it out.
      nextActionAt: new Date(
        Date.parse(evt.occurredAt) + (steps[0]?.offsetHours ?? 24) * 3600_000,
      ).toISOString(),
      updateUrl: this.buildUpdateUrl({
        companyId: evt.companyId,
        membershipId: member.membershipId,
        action: "resubscribe",
      }),
      messageLog: [],
      appliedEventIds: [evt.eventId],
    };
    await this.store.saveCase(c);
    return { applied: true, caseId: id, action: "winback_opened" };
  }

  private async onDisputeCreated(
    evt: Extract<EngineEvent, { kind: "dispute_created" }>,
  ): Promise<HandleResult> {
    const who = evt.username ? `@${evt.username}` : "a member";
    const cfg = await this.config(evt.companyId);
    const tier: Tier = cfg?.tier ?? "free";

    // Free tier (or no dispute id / no drafter wired) → plain alert, same as
    // before. Pro tier auto-drafts evidence so the creator only has to review
    // and submit before the response deadline.
    let evidenceStatus: Alert["evidenceStatus"] = "not_applicable";
    if (tier === "pro" && evt.disputeId && this.evidenceDrafter) {
      try {
        const relatedCase = evt.membershipId
          ? await this.store.getCase(caseId(evt.companyId, evt.membershipId))
          : null;
        await this.evidenceDrafter.draft({
          disputeId: evt.disputeId,
          companyId: evt.companyId,
          config: cfg,
          relatedCase,
          customerName: evt.username,
        });
        evidenceStatus = "drafted";
      } catch {
        evidenceStatus = "failed";
      }
    }

    const detail =
      evidenceStatus === "drafted"
        ? `${who} opened a dispute. Recover auto-drafted evidence (access history + billing context) — review and submit it from the dashboard before the response deadline.`
        : `${who} opened a dispute. Respond fast with access + usage evidence to avoid losing the funds and risking your payout standing.`;

    return this.raiseAlert({
      companyId: evt.companyId,
      kind: "chargeback",
      severity: "critical",
      title: "Chargeback opened",
      detail,
      amountCents: evt.amountCents,
      currency: evt.currency,
      dedupe: evt.eventId,
      occurredAt: evt.occurredAt,
      disputeId: evt.disputeId,
      evidenceStatus,
    });
  }

  /**
   * Retro-drafts evidence for any open, un-drafted chargeback alerts once a
   * company confirms its Recover Pro upgrade (e.g. mid-dispute).
   */
  private async onProTierConfirmed(
    evt: Extract<EngineEvent, { kind: "pro_tier_confirmed" }>,
  ): Promise<HandleResult> {
    if (!this.evidenceDrafter) {
      return { applied: false, action: "noop" };
    }

    const alerts = await this.store.listAlertsByCompany(evt.companyId);
    const pending = alerts.filter(
      (a) =>
        a.kind === "chargeback" &&
        a.disputeId &&
        a.evidenceStatus !== "drafted",
    );
    if (pending.length === 0) {
      return { applied: false, action: "noop" };
    }

    const cfg = await this.config(evt.companyId);
    let draftedAny = false;
    for (const a of pending) {
      try {
        await this.evidenceDrafter.draft({
          disputeId: a.disputeId!,
          companyId: evt.companyId,
          config: cfg,
          relatedCase: null,
        });
        a.evidenceStatus = "drafted";
        draftedAny = true;
      } catch {
        a.evidenceStatus = "failed";
      }
      await this.store.saveAlert(a);
    }

    return {
      applied: draftedAny,
      action: draftedAny ? "evidence_retro_drafted" : "noop",
    };
  }

  private async onRefundCreated(
    evt: Extract<EngineEvent, { kind: "refund_created" }>,
  ): Promise<HandleResult> {
    const who = evt.username ? `@${evt.username}` : "a member";
    return this.raiseAlert({
      companyId: evt.companyId,
      kind: "refund",
      severity: "warning",
      title: "Refund issued",
      detail: `A refund was issued to ${who}. Worth a quick look if refunds are trending up.`,
      amountCents: evt.amountCents,
      currency: evt.currency,
      dedupe: evt.eventId,
      occurredAt: evt.occurredAt,
    });
  }

  private async raiseAlert(input: {
    companyId: string;
    kind: Alert["kind"];
    severity: Alert["severity"];
    title: string;
    detail: string;
    amountCents?: number;
    currency?: string;
    dedupe: string;
    occurredAt: string;
    disputeId?: string;
    evidenceStatus?: Alert["evidenceStatus"];
  }): Promise<HandleResult> {
    const alertId = `al_${input.companyId}_${input.dedupe}`;
    const existing = await this.store.getAlert(alertId);
    if (existing) {
      return { applied: false, action: "duplicate_ignored", alertId };
    }
    const alert: Alert = {
      id: alertId,
      companyId: input.companyId,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      detail: input.detail,
      amountCents: input.amountCents,
      currency: input.currency,
      createdAt: input.occurredAt,
      acknowledged: false,
      disputeId: input.disputeId,
      evidenceStatus: input.evidenceStatus,
    };
    await this.store.saveAlert(alert);
    return { applied: true, action: "alert_created", alertId };
  }

  /**
   * At-risk scan (phase 2). Given engagement snapshots for a company's members,
   * score each and raise an alert for anyone newly in the high-risk band. The
   * snapshot source is injected by the caller (Whop API / analytics), keeping
   * the scoring logic pure and testable.
   */
  async scanAtRisk(
    companyId: string,
    snapshots: EngagementSnapshot[],
  ): Promise<RiskAssessment[]> {
    const assessments = snapshots.map(assessRisk);
    const high = assessments.filter((a) => a.band === "high");
    for (const a of high) {
      await this.raiseAlert({
        companyId,
        kind: "at_risk",
        severity: "warning",
        title: "Member at high risk of churning",
        detail: `${a.username ? "@" + a.username : "A member"} is showing churn signals: ${a.reasons.join(", ")}. Reach out before their next renewal.`,
        amountCents: a.amountCents,
        currency: a.currency,
        dedupe: `atrisk_${a.membershipId}_${this.clock.now().toISOString().slice(0, 10)}`,
        occurredAt: this.clock.now().toISOString(),
      });
    }
    return assessments;
  }

  /**
   * Cron entry point: process every active case whose next dunning step is due.
   * Returns the number of steps sent.
   */
  async processDue(): Promise<number> {
    const nowIso = this.clock.now().toISOString();
    const due = await this.store.listDueCases(nowIso);
    let sent = 0;
    for (const stale of due) {
      const c = await this.store.getCase(stale.id);
      if (!c || c.status !== "active") continue;
      const cfg = await this.config(c.companyId);
      const steps = stepsForType(c.type, cfg);
      const didSend = await this.sendNextStep(c, steps, cfg);
      if (didSend) sent += 1;
    }
    return sent;
  }

  /**
   * Send the case's next scheduled dunning step and advance the schedule.
   * If there are no steps left, mark the case lost.
   */
  private async sendNextStep(
    c: RecoveryCase,
    steps: SequenceStep[],
    cfg: CompanyConfig | null,
  ): Promise<boolean> {
    const stepIndex = c.attemptsSent;
    const step = steps[stepIndex];

    if (!step) {
      // Sequence exhausted and still unpaid → count as lost.
      c.status = "lost";
      c.lostAt = this.clock.now().toISOString();
      c.nextActionAt = null;
      await this.store.saveCase(c);
      return false;
    }

    const content = renderTemplate(step.template, {
      username: c.member.username ?? "there",
      amountCents: c.amountCents,
      currency: c.currency,
      plan: c.planName,
      community: cfg?.communityName ?? "the community",
      updateUrl: c.updateUrl,
    });

    const delivered = await this.messenger.send({
      companyId: c.companyId,
      userId: c.member.userId,
      dmChannelId: c.member.dmChannelId,
      content,
    });

    c.member.dmChannelId = delivered.channelId;
    c.messageLog.push({
      stepIndex,
      sentAt: this.clock.now().toISOString(),
      channelId: delivered.channelId,
      messageId: delivered.messageId,
      preview: content.slice(0, 80),
    });
    c.attemptsSent = stepIndex + 1;

    // Schedule the next step. If this was the last step, schedule one final
    // check after a grace period: if the member still hasn't paid by then, the
    // next processDue pass marks the case lost. (A membership_deactivated
    // webhook will also mark it lost sooner, whichever comes first.)
    const base = Date.parse(c.failedAt);
    const nextStep = steps[c.attemptsSent];
    if (nextStep) {
      c.nextActionAt = new Date(
        base + nextStep.offsetHours * 3600_000,
      ).toISOString();
    } else {
      const lastOffset = steps[steps.length - 1]?.offsetHours ?? 0;
      c.nextActionAt = new Date(
        base + (lastOffset + RecoveryEngine.GRACE_HOURS) * 3600_000,
      ).toISOString();
    }

    await this.store.saveCase(c);
    return true;
  }
}

/** Convenience factory for local/dev usage with in-memory deps. */
export function createInMemoryEngine(appBaseUrl = "http://localhost:3000") {
  const store = new InMemoryStore();
  const messenger = new MockMessenger();
  const engine = new RecoveryEngine({ store, messenger, appBaseUrl });
  return { store, messenger, engine };
}
