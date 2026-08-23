/**
 * WhopEvidenceDrafter — drafts real dispute evidence via the Whop API.
 *
 * Calls `disputes.updateEvidence`, a safe, reversible PATCH-style call
 * (verified against the live API: it's the correct method name, distinct
 * from `disputes.submitEvidence`). This class NEVER calls submitEvidence —
 * submission is irreversible and only ever triggered by the creator from the
 * dashboard, via /api/disputes/[disputeId]/submit.
 *
 * The client is loosely typed (same pattern as WhopMessenger in
 * core/messaging.ts) so this file has no hard compile dependency on the
 * SDK's evolving generics.
 *
 * Docs: https://docs.whop.com (Disputes — update evidence / submit evidence)
 */

import { buildEvidenceDraft, type DraftInput, type EvidenceDrafter } from "../core/evidence";
import type { DisputeEvidenceDraft } from "../core/types";

export interface WhopDisputesLike {
  disputes: {
    updateEvidence(id: string, body: Record<string, unknown>): Promise<unknown>;
  };
}

export class WhopEvidenceDrafter implements EvidenceDrafter {
  constructor(private client: WhopDisputesLike) {}

  async draft(input: DraftInput): Promise<DisputeEvidenceDraft> {
    const draft = buildEvidenceDraft(input);
    await this.client.disputes.updateEvidence(draft.disputeId, {
      product_description: draft.productDescription,
      refund_policy_disclosure: draft.refundPolicyDisclosure,
      cancellation_policy_disclosure: draft.cancellationPolicyDisclosure,
      customer_email_address: draft.customerEmailAddress ?? null,
      customer_name: draft.customerName ?? null,
      service_date: draft.serviceDate ?? null,
      notes: draft.notes,
    });
    return draft;
  }
}
