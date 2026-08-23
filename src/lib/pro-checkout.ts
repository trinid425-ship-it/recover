/**
 * Recover Pro checkout — creates a Whop checkout configuration for the Pro
 * plan (PRO_PLAN_ID, sold on Recover's own whop, PRO_COMPANY_ID) tagged with
 * the purchasing company's id in `metadata.installing_company_id`.
 *
 * Payments and memberships created from a checkout session inherit its
 * metadata (docs: developer/guides/accept-payments), so that key survives
 * onto the resulting payment webhook without any extra plumbing. mapping.ts
 * reads it back off `payment.succeeded` to fire a `pro_tier_confirmed` event
 * for the *installing* company — not PRO_COMPANY_ID, which is whose webhook
 * actually delivers the event.
 *
 * Docs: https://docs.whop.com/developer/guides/accept-payments
 */

import { PRO_PLAN_ID } from "./constants";
import { whopClient } from "./whop";

export interface ProCheckout {
  id: string;
  purchaseUrl: string;
}

/** Creates a one-off checkout session for `companyId` to purchase Recover Pro. */
export async function createProCheckout(
  companyId: string,
  redirectUrl?: string,
): Promise<ProCheckout> {
  // Loosely typed — same rationale as WhopMessenger/WhopEvidenceDrafter: avoids
  // a hard compile dependency on the SDK's evolving checkout-configuration generics.
  const config = await (whopClient() as any).checkoutConfigurations.create({
    plan_id: PRO_PLAN_ID,
    metadata: { installing_company_id: companyId },
    redirect_url: redirectUrl ?? null,
  });

  const rawUrl: string = config.purchase_url;
  const purchaseUrl = rawUrl.startsWith("http")
    ? rawUrl
    : `https://whop.com${rawUrl}`;

  return { id: config.id, purchaseUrl };
}
