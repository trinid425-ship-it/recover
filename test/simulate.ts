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
import { MockMessenger } from "../src/core/messaging.js";
import { InMemoryStore } from "../src/core/store.js";
import { computeMetrics } from "../src/core/revenue.js";
import { DEFAULT_STEPS } from "../src/core/sequences.js";
import type { Clock, EngineEvent } from "../src/core/types.js";

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
  const engine = new RecoveryEngine({
    store,
    messenger,
    clock,
    appBaseUrl: "https://recover.app",
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
