/**
 * Dispute evidence drafting (Recover Pro).
 *
 * Mirrors the sequences.ts / atrisk.ts pattern: a pure, fully-testable
 * `buildEvidenceDraft()` function plus a pluggable `EvidenceDrafter`
 * interface. The real implementation (src/lib/disputes.ts) calls Whop's
 * "update evidence" endpoint — a safe, reversible draft. Nothing here ever
 * submits a dispute; only the creator, from the dashboard, does that.
 */

import {
  DEFAULT_CANCELLATION_POLICY_DISCLOSURE,
  DEFAULT_REFUND_POLICY_DISCLOSURE,
} from "../lib/constants";
import type { CompanyConfig, DisputeEvidenceDraft, RecoveryCase } from "./types";

export interface DraftInput {
  disputeId: string;
  companyId: string;
  config: CompanyConfig | null;
  /** The recovery case tied to this member/membership, if one is on file. */
  relatedCase: RecoveryCase | null;
  customerEmailAddress?: string;
  customerName?: string;
}

/** Pure composition of an evidence draft from case history + policy config. */
export function buildEvidenceDraft(input: DraftInput): DisputeEvidenceDraft {
  const cfg = input.config;
  const community = cfg?.communityName ?? "our community";
  const c = input.relatedCase;

  const productDescription =
    cfg?.productDescription ??
    (c
      ? `Recurring membership access to ${community} (${c.planName}).`
      : `Recurring membership access to ${community}.`);

  const refundPolicyDisclosure =
    cfg?.refundPolicyDisclosure ?? DEFAULT_REFUND_POLICY_DISCLOSURE;
  const cancellationPolicyDisclosure =
    cfg?.cancellationPolicyDisclosure ?? DEFAULT_CANCELLATION_POLICY_DISCLOSURE;

  const notesLines: string[] = [];
  if (c) {
    const who = c.member.username ? `@${c.member.username}` : c.member.userId;
    notesLines.push(
      `Member ${who} held a "${c.planName}" membership in ${community}.`,
    );
    notesLines.push(
      `Recover's records show ${c.messageLog.length} billing-related touch(es) logged for this membership; case status at time of dispute: ${c.status}.`,
    );
    if (c.status === "recovered" && c.recoveredAt) {
      notesLines.push(
        `Payment succeeded on ${c.recoveredAt}, after a prior failed attempt was resolved directly by the member.`,
      );
    }
  } else {
    notesLines.push(
      "No open recovery case was on file for this member at the time of the dispute — the membership was in good standing.",
    );
  }
  notesLines.push(
    "Access to the product was granted immediately upon payment and remained active through the disputed billing period.",
  );

  return {
    disputeId: input.disputeId,
    companyId: input.companyId,
    productDescription,
    refundPolicyDisclosure,
    cancellationPolicyDisclosure,
    customerEmailAddress: input.customerEmailAddress,
    customerName: input.customerName,
    serviceDate: c?.failedAt,
    notes: notesLines.join(" "),
  };
}

export interface EvidenceDrafter {
  draft(input: DraftInput): Promise<DisputeEvidenceDraft>;
}

/** In-memory drafter for tests — records drafts, can be told to fail on demand. */
export class MockEvidenceDrafter implements EvidenceDrafter {
  public drafted: DisputeEvidenceDraft[] = [];
  public shouldFail = false;

  async draft(input: DraftInput): Promise<DisputeEvidenceDraft> {
    if (this.shouldFail) {
      throw new Error("mock evidence draft failure");
    }
    const draft = buildEvidenceDraft(input);
    this.drafted.push(draft);
    return draft;
  }
}
