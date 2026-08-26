/**
 * Historical scan — the "instant value" feature.
 *
 * On install (or on demand from the dashboard), scans the installing
 * company's already-failing payments and opens recovery cases for them
 * retroactively, instead of waiting for the next payment.failed webhook.
 * This is what lets a company see, and start recovering, real at-risk
 * revenue within minutes of installing rather than at the next card
 * decline.
 *
 * Reuses the engine's ordinary payment_failed handling (see
 * backfill-mapping.ts), which is idempotent per membership — running the
 * scan twice, or rescanning a membership the engine already has an active
 * case for, is always safe and never double-sends a DM.
 */

import { getEngine } from "./runtime";
import { whopClient } from "./whop";
import { isBackfillCandidate, mapPaymentToFailedEvent } from "./backfill-mapping";

export interface BackfillResult {
  scanned: number;
  opened: number;
  skipped: number;
}

const PAGE_SIZE = 50;
/** Hard cap so a company with a huge payment history can't run away the scan. */
const MAX_PAGES = 20;

export async function backfillCompany(companyId: string): Promise<BackfillResult> {
  // Loosely typed — same rationale as WhopMessenger/pro-checkout: avoids a
  // hard compile dependency on the SDK's evolving payments.list generics.
  const client = whopClient() as any;
  const result: BackfillResult = { scanned: 0, opened: 0, skipped: 0 };

  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await client.payments.list({
      company_id: companyId,
      statuses: ["open"],
      first: PAGE_SIZE,
      after,
    });
    const items: any[] = res?.data ?? [];
    if (items.length === 0) break;

    for (const p of items) {
      result.scanned += 1;
      if (!isBackfillCandidate(p)) {
        result.skipped += 1;
        continue;
      }
      const evt = mapPaymentToFailedEvent(companyId, p);
      if (!evt) {
        result.skipped += 1;
        continue;
      }
      const handled = await getEngine().handle(evt);
      if (handled.action === "opened") {
        result.opened += 1;
      } else {
        // duplicate_ignored / noop — a case already exists for this
        // membership (e.g. the live webhook beat the scan to it).
        result.skipped += 1;
      }
    }

    if (!res?.page_info?.has_next_page) break;
    after = res.page_info.end_cursor;
  }

  return result;
}
