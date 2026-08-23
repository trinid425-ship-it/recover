/**
 * Recover Pro tier sync.
 *
 * Recover sells its own Pro plan on Recover's own Whop (PRO_COMPANY_ID /
 * PRO_PLAN_ID). Until full checkout metadata wiring exists, a purchasing
 * company's membership is expected to carry the installing company's id in
 * `metadata.installing_company_id` — set at checkout time. This module
 * live-checks that, caches the result on the company's config, and exposes a
 * network-free cached read for use as a fallback.
 */

import type { RecoveryStore } from "../core/store";
import type { Tier } from "../core/types";
import { PRO_COMPANY_ID, PRO_PLAN_ID } from "./constants";
import { whopClient } from "./whop";

/** Cached read — no network call. Used as the fallback when the live check fails. */
export async function cachedTier(
  store: RecoveryStore,
  companyId: string,
): Promise<Tier> {
  const cfg = await store.getConfig(companyId);
  return cfg?.tier ?? "free";
}

/**
 * Live-checks Recover's own memberships for an active Pro membership tagged
 * with `companyId`, caches the result into the company's config, and returns
 * it. Falls back to the cached tier (never silently downgrades) on any API
 * failure, so a Whop outage never revokes Pro access.
 */
export async function syncProTier(
  store: RecoveryStore,
  companyId: string,
): Promise<Tier> {
  let tier: Tier;
  try {
    // Loosely typed — avoids a hard compile dependency on the SDK's evolving
    // memberships.list generics, same rationale as WhopMessenger.
    const page = await (whopClient() as any).memberships.list({
      company_id: PRO_COMPANY_ID,
      plan_id: PRO_PLAN_ID,
      valid: true,
      first: 50,
    });
    const match = (page?.data ?? []).some(
      (m: any) => m?.metadata?.installing_company_id === companyId,
    );
    tier = match ? "pro" : "free";
  } catch {
    return cachedTier(store, companyId);
  }

  const existing = await store.getConfig(companyId);
  const cfg = existing ?? {
    companyId,
    enabled: true,
    communityName: "your community",
  };
  await store.saveConfig({ ...cfg, tier });
  return tier;
}
