/**
 * Engagement data provider for the at-risk scan.
 *
 * The at-risk scorer (src/core/atrisk.ts) is pure and takes EngagementSnapshots.
 * This is the seam where those snapshots come from real data. Whop exposes
 * membership + activity data via its API; wire that here during live
 * integration. Until then this returns [] so the scan is a safe no-op.
 *
 * Implementation sketch for live:
 *   1. List active memberships for the company (client.memberships.list).
 *   2. For each, pull last-active + message counts (chat/activity endpoints).
 *   3. Map into EngagementSnapshot and return.
 */

import type { EngagementSnapshot } from "../core/types.js";

export interface EngagementProvider {
  snapshots(companyId: string): Promise<EngagementSnapshot[]>;
}

/** Live provider stub — returns nothing until Whop activity data is wired. */
export class WhopEngagementProvider implements EngagementProvider {
  async snapshots(_companyId: string): Promise<EngagementSnapshot[]> {
    // TODO(live): pull memberships + activity from the Whop API and map them.
    return [];
  }
}

export function getEngagementProvider(): EngagementProvider {
  return new WhopEngagementProvider();
}
