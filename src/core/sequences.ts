/**
 * The dunning sequence: the timed series of DMs we send after a payment fails.
 *
 * Design notes (why this cadence):
 *  - Involuntary churn is mostly expired/insufficient cards, not intent to
 *    leave. So copy is helpful, not accusatory — a friendly nudge with a
 *    one-tap fix link outperforms "your payment failed" dunning.
 *  - We escalate urgency as the membership approaches deactivation, and stop
 *    before becoming spam. Four touches over 7 days is the sweet spot in
 *    subscription dunning benchmarks.
 */

import type { CompanyConfig } from "./types";

export interface SequenceStep {
  /** Hours after the initial payment failure this step fires. */
  offsetHours: number;
  template: string;
}

/**
 * Template variables:
 *   {username}   member's handle
 *   {amount}     formatted amount, e.g. "$49.00"
 *   {plan}       plan name
 *   {community}  creator's community name
 *   {updateUrl}  one-tap link to fix the payment method
 */
export const DEFAULT_STEPS: SequenceStep[] = [
  {
    offsetHours: 0,
    template:
      "Hey {username} — quick heads up, your last {amount} payment for {plan} didn't go through (usually just an expired or maxed card). You can fix it in one tap here so you don't lose access: {updateUrl}",
  },
  {
    offsetHours: 48,
    template:
      "Hi {username}, still seeing the {amount} charge for {plan} as unpaid. Your spot in {community} is safe for now, but I'd hate for you to get locked out over a card issue. Update it here: {updateUrl}",
  },
  {
    offsetHours: 96,
    template:
      "{username}, your access to {community} is about to pause because the {plan} payment hasn't cleared. Takes 30 seconds to sort out: {updateUrl}",
  },
  {
    offsetHours: 168,
    template:
      "Last one, {username} — after today your {plan} membership in {community} will lapse. If it was just a card thing, you can restore everything instantly here: {updateUrl}. Either way, thanks for being part of it.",
  },
];

/**
 * Win-back sequence: sent when a member cancels cleanly (no payment failure).
 * Softer, offer-led, more spaced out — they chose to leave, so we lead with
 * value and a reason to return rather than urgency.
 *
 * {updateUrl} here is a resubscribe/offer link.
 */
export const WINBACK_STEPS: SequenceStep[] = [
  {
    offsetHours: 24,
    template:
      "Hey {username}, saw you cancelled {plan} — no hard feelings! Mind sharing what made you leave? If it's the price or timing, I might be able to help. You can always come back here: {updateUrl}",
  },
  {
    offsetHours: 72,
    template:
      "{username}, since you left {community} we've kept shipping — new drops and updates you're missing. If you want back in, your spot's here: {updateUrl}",
  },
  {
    offsetHours: 168,
    template:
      "Last note, {username} — here's a one-time offer to rejoin {community} at a discount: {updateUrl}. Open for 48 hours. Would love to have you back.",
  },
];

/** Pick the right base sequence for a case type (before config overrides). */
export function stepsForType(
  type: "involuntary" | "winback",
  config: CompanyConfig | null,
): SequenceStep[] {
  if (type === "winback") return WINBACK_STEPS;
  return resolveSteps(config);
}

export function resolveSteps(config: CompanyConfig | null): SequenceStep[] {
  if (!config) return DEFAULT_STEPS;
  const offsets = config.stepOffsetsHours;
  const custom = config.customTemplates;
  if (!offsets && !custom) return DEFAULT_STEPS;

  const length = offsets?.length ?? custom?.length ?? DEFAULT_STEPS.length;
  const steps: SequenceStep[] = [];
  for (let i = 0; i < length; i++) {
    steps.push({
      offsetHours: offsets?.[i] ?? DEFAULT_STEPS[i]?.offsetHours ?? i * 48,
      template:
        custom?.[i] ?? DEFAULT_STEPS[i]?.template ?? DEFAULT_STEPS[0]!.template,
    });
  }
  return steps;
}

export interface RenderContext {
  username: string;
  amountCents: number;
  currency: string;
  plan: string;
  community: string;
  updateUrl: string;
}

export function formatAmount(amountCents: number, currency: string): string {
  const value = amountCents / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function renderTemplate(template: string, ctx: RenderContext): string {
  return template
    .replaceAll("{username}", ctx.username || "there")
    .replaceAll("{amount}", formatAmount(ctx.amountCents, ctx.currency))
    .replaceAll("{plan}", ctx.plan || "your membership")
    .replaceAll("{community}", ctx.community || "the community")
    .replaceAll("{updateUrl}", ctx.updateUrl);
}
