/**
 * Seed the file store with a realistic mix so the dashboard renders fully:
 * recovered + lost + in-progress recoveries, a win-back case, and chargeback /
 * refund / at-risk alerts. Run: npx tsx test/seed.ts
 */
import { RecoveryEngine } from "../src/core/engine.js";
import { MockMessenger } from "../src/core/messaging.js";
import { FileStore } from "../src/lib/store-file.js";
import type { EngagementSnapshot } from "../src/core/types.js";

const COMPANY = "biz_southern_caribbean";
const store = new FileStore();
const engine = new RecoveryEngine({
  store,
  messenger: new MockMessenger(),
  appBaseUrl: "https://recover.app",
});

const day = 86400_000;
const now = Date.now();

const members = [
  { id: "m1", u: "marcus", amt: 4900, plan: "Pro Monthly", pays: true },
  { id: "m2", u: "keisha", amt: 9900, plan: "VIP Monthly", pays: true },
  { id: "m3", u: "andre", amt: 4900, plan: "Pro Monthly", pays: true },
  { id: "m4", u: "tanya", amt: 14900, plan: "Signals Elite", pays: false },
  { id: "m5", u: "devon", amt: 4900, plan: "Pro Monthly", pays: null }, // active
  { id: "m6", u: "priya", amt: 9900, plan: "VIP Monthly", pays: true },
];

async function main() {
  await store.saveConfig({
    companyId: COMPANY,
    enabled: true,
    communityName: "Southern Caribbean Whop",
  });

  // Involuntary recoveries.
  for (const m of members) {
    await engine.handle({
      kind: "payment_failed",
      eventId: `f_${m.id}`,
      companyId: COMPANY,
      member: { membershipId: m.id, userId: `u_${m.id}`, username: m.u },
      amountCents: m.amt,
      currency: "usd",
      planName: m.plan,
      occurredAt: new Date(now - 3 * day).toISOString(),
    });
    if (m.pays === true) {
      await engine.handle({
        kind: "payment_succeeded",
        eventId: `p_${m.id}`,
        companyId: COMPANY,
        membershipId: m.id,
        amountCents: m.amt,
        occurredAt: new Date(now - 2 * day).toISOString(),
      });
    } else if (m.pays === false) {
      await engine.handle({
        kind: "membership_deactivated",
        eventId: `d_${m.id}`,
        companyId: COMPANY,
        membershipId: m.id,
        occurredAt: new Date(now - 1 * day).toISOString(),
      });
    }
  }

  // A voluntary cancellation → win-back in progress.
  await engine.handle({
    kind: "membership_deactivated",
    eventId: "d_wb1",
    companyId: COMPANY,
    membershipId: "m7",
    occurredAt: new Date(now - 1 * day).toISOString(),
    voluntary: true,
    member: { membershipId: "m7", userId: "u_m7", username: "jerome" },
    amountCents: 4900,
    currency: "usd",
    planName: "Pro Monthly",
  });

  // A chargeback + a refund → alerts.
  await engine.handle({
    kind: "dispute_created",
    eventId: "disp_1",
    companyId: COMPANY,
    membershipId: "m4",
    username: "tanya",
    amountCents: 14900,
    currency: "usd",
    occurredAt: new Date(now - 12 * 3600_000).toISOString(),
  });
  await engine.handle({
    kind: "refund_created",
    eventId: "ref_1",
    companyId: COMPANY,
    username: "lee",
    amountCents: 4900,
    currency: "usd",
    occurredAt: new Date(now - 6 * 3600_000).toISOString(),
  });

  // At-risk scan → flags a disengaged, renewing member.
  const snapshots: EngagementSnapshot[] = [
    {
      membershipId: "m8",
      userId: "u_m8",
      username: "shanice",
      companyId: COMPANY,
      daysSinceLastActive: 24,
      messages30d: 0,
      tenureDays: 90,
      renewalSoon: true,
      amountCents: 9900,
      currency: "usd",
    },
  ];
  await engine.scanAtRisk(COMPANY, snapshots);

  const cases = await store.listCasesByCompany(COMPANY);
  const alerts = await store.listAlertsByCompany(COMPANY);
  console.log(
    `Seeded ${cases.length} cases + ${alerts.length} alerts for ${COMPANY}. Open /dashboard.`,
  );
}
main();
