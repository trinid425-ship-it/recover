/**
 * End-to-end simulation of the recovery engine — no network, no framework.
 *
 * Proves the core behaviors:
 *   1. A failed payment opens a case and fires the first DM immediately.
 *   2. The cron processor sends subsequent dunning steps as they come due.
 *   3. A later successful payment marks the case recovered and counts revenue.
 *   4. A member who never pays exhausts the sequence and is marked lost.
 *   5. Duplicate webhooks are ignored (idempotency).
 *   6. Metrics (recovered revenue, recovery rate) compute correctly.
 */

import { RecoveryEngine } from "../src/core/engine.js";
import { MockEvidenceDrafter } from "../src/core/evidence.js";
import { MockMessenger } from "../src/core/messaging.js";
import { InMemoryStore } from "../src/core/store.js";
import { computeMetrics } from "../src/core/revenue.js";
import { DEFAULT_STEPS, resolveSteps } from "../src/core/sequences.js";
import { buildWeeklyDigest, hasDigestActivity, renderDigestMessage } from "../src/core/digest.js";
import type { Clock, EngineEvent } from "../src/core/types.js";
import { mapWebhook } from "../src/lib/mapping.js";
import { isBackfillCandidate, mapPaymentToFailedEvent } from "../src/lib/backfill-mapping.js";
import { verifyWhopWebhook, WebhookVerificationError } from "../src/lib/verify-webhook.js";
import { PRO_PLAN_ID, PRO_COMPANY_ID } from "../src/lib/constants.js";

// ── tiny test helpers ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${msg}\x1b[0m`);
  }
}

class FakeClock implements Clock {
  constructor(private t: number) {}
  now() {
    return new Date(this.t);
  }
  advanceHours(h: number) {
    this.t += h * 3600_000;
  }
  iso() {
    return new Date(this.t).toISOString();
  }
}

const COMPANY = "biz_alpha";
const HOUR = 3600_000;

async function main() {
  const clock = new FakeClock(Date.parse("2026-07-01T00:00:00.000Z"));
  const store = new InMemoryStore();
  const messenger = new MockMessenger();
  const evidenceDrafter = new MockEvidenceDrafter();
  const engine = new RecoveryEngine({
    store,
    messenger,
    clock,
    appBaseUrl: "https://recover.app",
    evidenceDrafter,
  });

  await store.saveConfig({
    companyId: COMPANY,
    enabled: true,
    communityName: "Alpha Trades",
  });

  console.log("\n\x1b[1mScenario A — member's card fails, then they fix it\x1b[0m");

  const failEvt: EngineEvent = {
    kind: "payment_failed",
    eventId: "evt_1",
    companyId: COMPANY,
    member: { membershipId: "mem_1", userId: "user_1", username: "duane" },
    amountCents: 4900,
    currency: "usd",
    planName: "Pro Monthly",
    occurredAt: clock.iso(),
  };
  const r1 = await engine.handle(failEvt);
  assert(r1.action === "opened", "failed payment opens a recovery case");
  assert(messenger.sent.length === 1, "first dunning DM sent immediately");
  assert(
    messenger.sent[0]!.content.includes("$49.00"),
    "DM shows the failed amount ($49.00)",
  );
  assert(
    messenger.sent[0]!.content.includes("https://recover.app"),
    "DM includes the one-tap update link",
  );

  // Idempotency: same webhook again should not resend.
  const dup = await engine.handle(failEvt);
  assert(dup.action === "duplicate_ignored", "duplicate webhook is ignored");
  assert(messenger.sent.length === 1, "no duplicate DM sent");

  // Advance 48h → step 2 due.
  clock.advanceHours(48);
  let sent = await engine.processDue();
  assert(sent === 1 && messenger.sent.length === 2, "step 2 sent at +48h");

  // Member pays → recovered.
  const payEvt: EngineEvent = {
    kind: "payment_succeeded",
    eventId: "evt_pay_1",
    companyId: COMPANY,
    membershipId: "mem_1",
    amountCents: 4900,
    occurredAt: clock.iso(),
  };
  const r2 = await engine.handle(payEvt);
  assert(r2.action === "recovered", "successful payment marks case recovered");

  // Further processing should not message a recovered member.
  clock.advanceHours(48);
  sent = await engine.processDue();
  assert(sent === 0, "no more DMs after recovery");

  console.log("\n\x1b[1mScenario B — member never fixes card, churns\x1b[0m");

  const before = messenger.sent.length;
  const fail2: EngineEvent = {
    kind: "payment_failed",
    eventId: "evt_2",
    companyId: COMPANY,
    member: { membershipId: "mem_2", userId: "user_2", username: "sam" },
    amountCents: 9900,
    currency: "usd",
    planName: "VIP Monthly",
    occurredAt: clock.iso(),
  };
  await engine.handle(fail2);
  assert(messenger.sent.length === before + 1, "case B first DM sent immediately");

  // Simulate the scheduler running every 6 hours for ~10 days. The member never
  // pays, so every dunning step fires on schedule and the case eventually closes.
  for (let h = 0; h < 240; h += 6) {
    clock.advanceHours(6);
    await engine.processDue();
  }

  const caseB = await store.getCase("rc_biz_alpha_mem_2");
  assert(
    caseB?.attemptsSent === DEFAULT_STEPS.length,
    `all ${DEFAULT_STEPS.length} dunning steps were attempted for churned member`,
  );
  assert(caseB?.status === "lost", "unrecovered member is marked lost");

  console.log("\n\x1b[1mScenario C — clean cancellation triggers win-back\x1b[0m");
  const cancelSent = messenger.sent.length;
  await engine.handle({
    kind: "membership_deactivated",
    eventId: "evt_cancel_1",
    companyId: COMPANY,
    membershipId: "mem_3",
    occurredAt: clock.iso(),
    voluntary: true,
    member: { membershipId: "mem_3", userId: "user_3", username: "nadia" },
    amountCents: 4900,
    currency: "usd",
    planName: "Pro Monthly",
  });
  const caseC = await store.getCase("rc_biz_alpha_mem_3");
  assert(caseC?.type === "winback", "clean cancellation opens a WIN-BACK case");
  assert(
    messenger.sent.length === cancelSent,
    "win-back first touch is scheduled, not sent instantly (softer cadence)",
  );
  // Run scheduler forward; win-back DMs should go out on their cadence.
  for (let h = 0; h < 48; h += 6) {
    clock.advanceHours(6);
    await engine.processDue();
  }
  assert(
    messenger.sent.length > cancelSent,
    "win-back sequence sends after its first offset",
  );
  assert(
    messenger.sent.some((s) => /cancelled|come back|rejoin|left/i.test(s.content)),
    "win-back copy is offer/return-led, not dunning",
  );

  console.log("\n\x1b[1mScenario D — chargeback raises a creator alert\x1b[0m");
  const d = await engine.handle({
    kind: "dispute_created",
    eventId: "evt_dispute_1",
    companyId: COMPANY,
    membershipId: "mem_9",
    username: "flagged_user",
    amountCents: 14900,
    currency: "usd",
    occurredAt: clock.iso(),
  });
  assert(d.action === "alert_created", "dispute.created raises an alert");
  const dupD = await engine.handle({
    kind: "dispute_created",
    eventId: "evt_dispute_1",
    companyId: COMPANY,
    membershipId: "mem_9",
    username: "flagged_user",
    amountCents: 14900,
    currency: "usd",
    occurredAt: clock.iso(),
  });
  assert(dupD.action === "duplicate_ignored", "duplicate dispute is deduped");
  const alerts = await store.listAlertsByCompany(COMPANY);
  assert(
    alerts.some((a) => a.kind === "chargeback" && a.severity === "critical"),
    "chargeback alert stored as critical",
  );
  const chargebackAlert = alerts.find((a) => a.kind === "chargeback");
  assert(
    chargebackAlert?.evidenceStatus === "not_applicable",
    "free tier: chargeback alert has evidenceStatus=not_applicable",
  );
  assert(
    evidenceDrafter.drafted.length === 0,
    "free tier: evidence drafter is never invoked",
  );

  console.log(
    "\n\x1b[1mScenario D.2 — Recover Pro auto-drafts dispute evidence\x1b[0m",
  );
  const PRO_COMPANY = "biz_beta";
  await store.saveConfig({
    companyId: PRO_COMPANY,
    enabled: true,
    communityName: "Beta Circle",
    tier: "pro",
  });

  const disputeEvt1: EngineEvent = {
    kind: "dispute_created",
    eventId: "evt_dispute_pro_1",
    companyId: PRO_COMPANY,
    membershipId: "mem_pro_1",
    username: "pro_member",
    amountCents: 19900,
    currency: "usd",
    occurredAt: clock.iso(),
    disputeId: "dspt_pro_1",
    paymentId: "pay_pro_1",
  };
  const dPro1 = await engine.handle(disputeEvt1);
  assert(dPro1.action === "alert_created", "pro tier: dispute_created raises an alert");
  assert(
    evidenceDrafter.drafted.some((d) => d.disputeId === "dspt_pro_1"),
    "pro tier: evidence auto-drafted for the dispute",
  );
  const proAlerts1 = await store.listAlertsByCompany(PRO_COMPANY);
  const proAlert1 = proAlerts1.find((a) => a.disputeId === "dspt_pro_1");
  assert(
    proAlert1?.evidenceStatus === "drafted",
    "pro tier: alert marked evidenceStatus=drafted",
  );

  // Failure path — drafter throws, alert should still be raised but flagged failed.
  evidenceDrafter.shouldFail = true;
  const disputeEvt2: EngineEvent = {
    kind: "dispute_created",
    eventId: "evt_dispute_pro_2",
    companyId: PRO_COMPANY,
    membershipId: "mem_pro_2",
    username: "pro_member_2",
    amountCents: 5900,
    currency: "usd",
    occurredAt: clock.iso(),
    disputeId: "dspt_pro_2",
  };
  const dPro2 = await engine.handle(disputeEvt2);
  assert(
    dPro2.action === "alert_created",
    "pro tier: alert still raised even if the draft call fails",
  );
  const proAlerts2 = await store.listAlertsByCompany(PRO_COMPANY);
  const proAlert2 = proAlerts2.find((a) => a.disputeId === "dspt_pro_2");
  assert(
    proAlert2?.evidenceStatus === "failed",
    "pro tier: draft failure recorded as evidenceStatus=failed",
  );
  evidenceDrafter.shouldFail = false;

  // Retro-draft: a free-tier company gets a dispute (not_applicable), then upgrades.
  const RETRO_COMPANY = "biz_gamma";
  await store.saveConfig({
    companyId: RETRO_COMPANY,
    enabled: true,
    communityName: "Gamma Guild",
  });
  const retroDisputeEvt: EngineEvent = {
    kind: "dispute_created",
    eventId: "evt_dispute_retro_1",
    companyId: RETRO_COMPANY,
    username: "retro_member",
    amountCents: 3300,
    currency: "usd",
    occurredAt: clock.iso(),
    disputeId: "dspt_retro_1",
  };
  await engine.handle(retroDisputeEvt);
  const beforeUpgrade = await store.listAlertsByCompany(RETRO_COMPANY);
  assert(
    beforeUpgrade.find((a) => a.disputeId === "dspt_retro_1")?.evidenceStatus ===
      "not_applicable",
    "retro: dispute raised before upgrade has evidenceStatus=not_applicable",
  );

  await store.saveConfig({
    companyId: RETRO_COMPANY,
    enabled: true,
    communityName: "Gamma Guild",
    tier: "pro",
  });
  const draftedBeforeRetro = evidenceDrafter.drafted.length;
  const retroResult = await engine.handle({
    kind: "pro_tier_confirmed",
    eventId: "evt_pro_confirmed_1",
    companyId: RETRO_COMPANY,
    occurredAt: clock.iso(),
  });
  assert(
    retroResult.action === "evidence_retro_drafted",
    "retro: pro_tier_confirmed retro-drafts pending disputes",
  );
  const afterUpgrade = await store.listAlertsByCompany(RETRO_COMPANY);
  assert(
    afterUpgrade.find((a) => a.disputeId === "dspt_retro_1")?.evidenceStatus ===
      "drafted",
    "retro: pending dispute is now marked evidenceStatus=drafted",
  );
  assert(
    evidenceDrafter.drafted.length === draftedBeforeRetro + 1,
    "retro: exactly one new draft was recorded",
  );

  // Dedup: running pro_tier_confirmed again should not re-draft already-drafted alerts.
  const retroResult2 = await engine.handle({
    kind: "pro_tier_confirmed",
    eventId: "evt_pro_confirmed_2",
    companyId: RETRO_COMPANY,
    occurredAt: clock.iso(),
  });
  assert(
    retroResult2.action === "noop",
    "retro: re-running pro_tier_confirmed with nothing pending is a noop",
  );
  assert(
    evidenceDrafter.drafted.length === draftedBeforeRetro + 1,
    "retro: no duplicate draft calls on the second run",
  );

  console.log(
    "\n\x1b[1mScenario D.3 — pro_tier_confirmed persists tier on its own\x1b[0m",
  );
  const PURCHASE_COMPANY = "biz_delta";
  // No saveConfig call here — this company has no config on file yet, mirroring
  // a real first-time Pro purchase where the checkout webhook is the very
  // first event Recover ever sees for this companyId.
  const purchaseResult = await engine.handle({
    kind: "pro_tier_confirmed",
    eventId: "evt_pro_confirmed_purchase_1",
    companyId: PURCHASE_COMPANY,
    occurredAt: clock.iso(),
  });
  assert(
    purchaseResult.action === "noop",
    "pro_tier_confirmed with nothing pending is a noop action",
  );
  const purchaseCfg = await store.getConfig(PURCHASE_COMPANY);
  assert(
    purchaseCfg?.tier === "pro",
    "pro_tier_confirmed persists tier=pro even with no prior config",
  );

  const draftedBeforePurchase = evidenceDrafter.drafted.length;
  const purchaseDispute = await engine.handle({
    kind: "dispute_created",
    eventId: "evt_dispute_purchase_1",
    companyId: PURCHASE_COMPANY,
    membershipId: "mem_purchase_1",
    username: "purchase_member",
    amountCents: 2200,
    currency: "usd",
    occurredAt: clock.iso(),
    disputeId: "dspt_purchase_1",
  });
  assert(
    purchaseDispute.action === "alert_created",
    "post-purchase: dispute_created raises an alert without re-setting tier",
  );
  const purchaseAlerts = await store.listAlertsByCompany(PURCHASE_COMPANY);
  assert(
    purchaseAlerts.find((a) => a.disputeId === "dspt_purchase_1")
      ?.evidenceStatus === "drafted",
    "post-purchase: the persisted tier alone is enough to auto-draft evidence",
  );
  assert(
    evidenceDrafter.drafted.length === draftedBeforePurchase + 1,
    "post-purchase: exactly one new draft was recorded",
  );

  console.log(
    "\n\x1b[1mScenario D.4 — webhook mapping re-targets Pro purchases to the installing company\x1b[0m",
  );
  const proWebhookEvt = mapWebhook("payment.succeeded", {
    id: "pay_pro_webhook_1",
    company_id: PRO_COMPANY_ID, // the webhook always arrives on Recover's own company
    created_at: clock.iso(),
    plan: { id: PRO_PLAN_ID },
    metadata: { installing_company_id: "biz_epsilon" },
  });
  assert(
    proWebhookEvt?.kind === "pro_tier_confirmed",
    "mapWebhook turns a Pro-plan payment.succeeded into pro_tier_confirmed",
  );
  assert(
    proWebhookEvt?.kind === "pro_tier_confirmed" &&
      proWebhookEvt.companyId === "biz_epsilon",
    "mapWebhook re-targets the event at the installing company, not PRO_COMPANY_ID",
  );

  const ordinaryWebhookEvt = mapWebhook("payment.succeeded", {
    id: "pay_ordinary_1",
    company_id: COMPANY,
    membership_id: "mem_1",
    created_at: clock.iso(),
    plan: { id: "plan_unrelated" },
  });
  assert(
    ordinaryWebhookEvt?.kind === "payment_succeeded",
    "mapWebhook leaves non-Pro payments mapped as ordinary payment_succeeded",
  );

  console.log("\n\x1b[1mScenario E — at-risk scan flags a disengaged member\x1b[0m");
  const assessments = await engine.scanAtRisk(COMPANY, [
    {
      membershipId: "mem_active",
      userId: "u_a",
      username: "engaged",
      companyId: COMPANY,
      daysSinceLastActive: 1,
      messages30d: 40,
      tenureDays: 200,
      renewalSoon: false,
      amountCents: 4900,
      currency: "usd",
    },
    {
      membershipId: "mem_ghost",
      userId: "u_g",
      username: "ghost",
      companyId: COMPANY,
      daysSinceLastActive: 22,
      messages30d: 0,
      tenureDays: 120,
      renewalSoon: true,
      amountCents: 9900,
      currency: "usd",
    },
  ]);
  const ghost = assessments.find((a) => a.membershipId === "mem_ghost");
  const engaged = assessments.find((a) => a.membershipId === "mem_active");
  assert(ghost?.band === "high", "disengaged + renewing member scored HIGH risk");
  assert(engaged?.band === "low", "active member scored LOW risk");
  const alerts2 = await store.listAlertsByCompany(COMPANY);
  assert(
    alerts2.some((a) => a.kind === "at_risk"),
    "high-risk member generates an at-risk alert",
  );

  console.log("\n\x1b[1mScenario F — webhook signature verification (ws_ secret format)\x1b[0m");
  {
    const secret = "ws_testsecret0123456789abcdef0123456789abcdef0123456789abcdef01";
    const payload = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_test" } });
    const id = "msg_test123";
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign = `${id}.${timestamp}.${payload}`;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(toSign));
    const sig = Buffer.from(sigBuf).toString("base64");
    const headers = {
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${sig}`,
    };

    const verified = await verifyWhopWebhook(payload, headers, secret);
    assert(verified.type === "payment.succeeded", "valid ws_ signature verifies and parses payload");

    let tamperedThrew = false;
    try {
      await verifyWhopWebhook(payload.replace("pay_test", "pay_evil"), headers, secret);
    } catch (e) {
      tamperedThrew = e instanceof WebhookVerificationError;
    }
    assert(tamperedThrew, "tampered payload fails signature verification");

    let wrongSecretThrew = false;
    try {
      await verifyWhopWebhook(payload, headers, "ws_wrongsecret00000000000000000000000000000000000000000000000");
    } catch (e) {
      wrongSecretThrew = e instanceof WebhookVerificationError;
    }
    assert(wrongSecretThrew, "wrong secret fails signature verification");

    let staleThrew = false;
    try {
      const staleHeaders = { ...headers, "webhook-timestamp": String(timestamp - 3600) };
      await verifyWhopWebhook(payload, staleHeaders, secret);
    } catch (e) {
      staleThrew = e instanceof WebhookVerificationError;
    }
    assert(staleThrew, "stale timestamp (>5min old) rejected");
  }

  console.log("\n\x1b[1mScenario G — historical scan backfills pre-existing failures\x1b[0m");
  {
    // A payment already sitting in the "open, retried, unpaid" state before
    // Recover was ever installed — exactly what /payments returns for a
    // company that already had churn leaking before install.
    const openFailingPayment = {
      id: "pay_backfill_1",
      status: "open",
      payments_failed: 2,
      failure_message: "Your card was declined.",
      total: 49,
      currency: "usd",
      created_at: clock.iso(),
      last_payment_attempt: clock.iso(),
      user: { id: "user_backfill_1", username: "preexisting_member" },
      membership: { id: "mem_backfill_1" },
      product: { title: "Pro Monthly" },
    };
    assert(
      isBackfillCandidate(openFailingPayment),
      "an open payment with failed attempts is a backfill candidate",
    );

    const healthyOpenPayment = { id: "pay_ok_1", status: "open", payments_failed: 0 };
    assert(
      !isBackfillCandidate(healthyOpenPayment),
      "an open payment with zero failed attempts is NOT a backfill candidate",
    );

    const paidPayment = { id: "pay_paid_1", status: "paid", payments_failed: 1 };
    assert(
      !isBackfillCandidate(paidPayment),
      "a paid payment is never a backfill candidate regardless of past attempts",
    );

    const mapped = mapPaymentToFailedEvent(COMPANY, openFailingPayment);
    assert(mapped?.kind === "payment_failed", "backfilled payment maps to a payment_failed event");
    assert(
      mapped?.kind === "payment_failed" && mapped.amountCents === 4900,
      "backfill mapping converts $49 decimal dollars to 4900 cents",
    );
    assert(
      mapped?.kind === "payment_failed" && mapped.member.username === "preexisting_member",
      "backfill mapping carries the member's username through",
    );

    const missingIdentity = mapPaymentToFailedEvent(COMPANY, { id: "pay_x", status: "open" });
    assert(missingIdentity === null, "a payment with no membership/user id maps to null, not a crash");

    // Feed the mapped event through the real engine, exactly like backfill.ts does.
    const beforeBackfill = messenger.sent.length;
    const backfillResult = await engine.handle(mapped!);
    assert(backfillResult.action === "opened", "backfilled event opens a real recovery case");
    assert(messenger.sent.length === beforeBackfill + 1, "backfilled case sends its first DM immediately, same as a live failure");

    // Re-running the exact same scan (same payment, same eventId) must be a no-op.
    const rescan = await engine.handle(mapPaymentToFailedEvent(COMPANY, openFailingPayment)!);
    assert(rescan.action === "duplicate_ignored", "scanning the same payment twice never double-opens or double-DMs");
    assert(messenger.sent.length === beforeBackfill + 1, "no extra DM sent on rescan");
  }

  console.log("\n\x1b[1mScenario H — weekly digest summarizes real activity\x1b[0m");
  {
    // Build fresh cases anchored to "now" — the earlier scenarios' cases are
    // real but many days stale by this point in simulated time, so a
    // windowed digest correctly excludes them. Test the window itself with
    // data actually inside it.
    const now = clock.now();
    const inWindow = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString();
    const digestCases = [
      {
        id: "rc_digest_1",
        companyId: COMPANY,
        type: "involuntary" as const,
        member: { membershipId: "mem_d1", userId: "user_d1", username: "digest_recovered" },
        amountCents: 4900,
        currency: "usd",
        planName: "Pro Monthly",
        status: "recovered" as const,
        failedAt: inWindow(3),
        recoveredAt: inWindow(2),
        attemptsSent: 1,
        nextActionAt: null,
        updateUrl: "https://recover.app/r",
        messageLog: [],
        appliedEventIds: [],
      },
      {
        id: "rc_digest_2",
        companyId: COMPANY,
        type: "involuntary" as const,
        member: { membershipId: "mem_d2", userId: "user_d2", username: "digest_active" },
        amountCents: 9900,
        currency: "usd",
        planName: "VIP Monthly",
        status: "active" as const,
        failedAt: inWindow(1),
        attemptsSent: 1,
        nextActionAt: inWindow(-1),
        updateUrl: "https://recover.app/r",
        messageLog: [],
        appliedEventIds: [],
      },
      {
        // Outside the 7-day window — must NOT be counted.
        id: "rc_digest_stale",
        companyId: COMPANY,
        type: "involuntary" as const,
        member: { membershipId: "mem_d3", userId: "user_d3", username: "digest_stale" },
        amountCents: 100_00,
        currency: "usd",
        planName: "Pro Monthly",
        status: "recovered" as const,
        failedAt: inWindow(30),
        recoveredAt: inWindow(29),
        attemptsSent: 1,
        nextActionAt: null,
        updateUrl: "https://recover.app/r",
        messageLog: [],
        appliedEventIds: [],
      },
    ];

    const summary = buildWeeklyDigest(digestCases, now, 7);
    assert(summary.recoveredCount === 1, "digest counts only the in-window recovered case, not the 29-day-old one");
    assert(summary.recoveredRevenueCents === 4900, "digest recovered revenue matches only the in-window $49 recovery");
    assert(summary.activeCount === 1, "digest counts the currently-active case as a snapshot regardless of window");
    assert(hasDigestActivity(summary), "a company with real activity has digest-worthy content");

    const quietSummary = buildWeeklyDigest([], now, 7);
    assert(!hasDigestActivity(quietSummary), "an empty case list has nothing digest-worthy — stays a signal, not noise");

    const message = renderDigestMessage("Alpha Trades", summary);
    assert(message.includes("Alpha Trades"), "digest message names the community");
    assert(message.includes("Recovered"), "digest message reports recovered revenue");
    assert(/\$\d/.test(message), "digest message formats amounts as currency");
  }

  console.log("\n\x1b[1mScenario I — white-labeled message templates override the default copy\x1b[0m");
  {
    // This is the shape /api/config now always writes (see route.ts): one
    // entry per default step, blanks already resolved to that step's
    // default text server-side. Verifies the settings-panel contract, not
    // just the raw resolveSteps utility.
    const brandedTemplates = DEFAULT_STEPS.map((s) => s.template);
    brandedTemplates[0] = "Yo {username}, {plan} payment bounced — fix it: {updateUrl}";

    const brandedSteps = resolveSteps({
      companyId: "biz_branded",
      enabled: true,
      communityName: "Branded Co",
      customTemplates: brandedTemplates,
    });
    assert(
      brandedSteps[0]!.template.startsWith("Yo {username}"),
      "a company's custom template overrides the default step-1 copy",
    );
    assert(
      brandedSteps[1]!.template === DEFAULT_STEPS[1]!.template,
      "steps left as the default text still render the default copy",
    );
    assert(
      brandedSteps.length === DEFAULT_STEPS.length,
      "a full-length custom template array keeps all 4 dunning touches",
    );

    const defaultSteps = resolveSteps({
      companyId: "biz_unbranded",
      enabled: true,
      communityName: "Unbranded Co",
    });
    assert(
      defaultSteps[0]!.template === DEFAULT_STEPS[0]!.template,
      "a company with no custom templates gets Recover's default dunning copy untouched",
    );

    // Guard against the footgun /api/config now avoids: resolveSteps() sizes
    // the sequence off whichever override array is shortest, so a
    // short customTemplates array truncates the whole sequence. This is
    // exactly why the route always pads to full length before saving.
    const shortOverride = resolveSteps({
      companyId: "biz_short",
      enabled: true,
      communityName: "Short Co",
      customTemplates: ["only one override"],
    });
    assert(
      shortOverride.length === 1,
      "resolveSteps truncates to a short override array's length — the route must never save one",
    );
  }

  console.log("\n\x1b[1mMetrics\x1b[0m");
  const all = await store.listCasesByCompany(COMPANY);
  const m = computeMetrics(all.filter((c) => c.type === "involuntary"));
  console.log(
    `  recovered: $${(m.recoveredRevenueCents / 100).toFixed(2)} | ` +
      `lost: $${(m.lostRevenueCents / 100).toFixed(2)} | ` +
      `rate: ${m.recoveryRate === null ? "—" : Math.round(m.recoveryRate * 100) + "%"}`,
  );
  assert(m.recoveredRevenueCents === 4900, "recovered revenue = $49.00");
  assert(m.lostRevenueCents === 9900, "lost revenue = $99.00");
  assert(m.recoveryRate === 0.5, "recovery rate = 50% (1 of 2 resolved)");

  console.log(
    `\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed\n`,
  );
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
