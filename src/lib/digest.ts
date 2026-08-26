/**
 * Sends the weekly "you saved $X" digest DM to a company's admin.
 *
 * The pure summary/copy logic lives in core/digest.ts; this file is just the
 * network-touching glue: read config + cases, decide whether there's
 * anything worth saying, send it. Same layering as backfill.ts / disputes.ts.
 */

import { buildWeeklyDigest, hasDigestActivity, renderDigestMessage } from "../core/digest";
import { MockMessenger, WhopMessenger, type Messenger } from "../core/messaging";
import { getStore } from "./runtime";
import { whopClient } from "./whop";

export type DigestOutcome =
  | { sent: true; companyId: string }
  | { sent: false; companyId: string; reason: "no_recipient" | "disabled" | "nothing_to_report" };

function getDigestMessenger(): Messenger {
  const mode = (process.env.MESSENGER_MODE ?? "mock").toLowerCase();
  if (mode === "whop") return new WhopMessenger(whopClient() as any);
  return new MockMessenger();
}

export async function sendWeeklyDigest(companyId: string): Promise<DigestOutcome> {
  const store = getStore();
  const cfg = await store.getConfig(companyId);

  if (!cfg?.notifyUserId) return { sent: false, companyId, reason: "no_recipient" };
  if (cfg.enabled === false || cfg.digestEnabled === false) {
    return { sent: false, companyId, reason: "disabled" };
  }

  const cases = await store.listCasesByCompany(companyId);
  const summary = buildWeeklyDigest(cases);
  if (!hasDigestActivity(summary)) {
    return { sent: false, companyId, reason: "nothing_to_report" };
  }

  const content = renderDigestMessage(cfg.communityName, summary);
  await getDigestMessenger().send({
    companyId,
    userId: cfg.notifyUserId,
    content,
  });
  return { sent: true, companyId };
}

/** Fans the digest out across every installed company. Used by the weekly cron. */
export async function sendAllWeeklyDigests(): Promise<DigestOutcome[]> {
  const store = getStore();
  const companyIds = await store.listCompanyIds();
  const outcomes: DigestOutcome[] = [];
  for (const companyId of companyIds) {
    outcomes.push(await sendWeeklyDigest(companyId));
  }
  return outcomes;
}
