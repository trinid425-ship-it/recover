/**
 * Cross-cutting constants for Recover's own Pro plan (sold on Recover's own
 * Whop — Duane's company) and default dispute-evidence copy used when a
 * company hasn't configured its own policy text yet.
 */

/** The plan a company purchases to unlock Recover Pro (auto dispute evidence). */
export const PRO_PLAN_ID = "plan_STPCMIgYeQ6Gm";
/** The product Recover Pro is sold under. */
export const PRO_PRODUCT_ID = "prod_fRhayeY2wkUgA";
/** Recover's own company — memberships for the Pro plan live here. */
export const PRO_COMPANY_ID = "biz_BsRjChoeabnFm3";

export const DEFAULT_REFUND_POLICY_DISCLOSURE =
  "Refunds are available per the community's stated policy at time of purchase. " +
  "The member retained uninterrupted access to the product for the full billing " +
  "period in question and did not request a refund through any Whop-supported " +
  "channel prior to filing this dispute.";

export const DEFAULT_CANCELLATION_POLICY_DISCLOSURE =
  "Members may cancel at any time from their Whop account settings, which " +
  "immediately stops future billing. No cancellation request was received " +
  "from this member prior to the disputed charge.";
