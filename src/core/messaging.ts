/**
 * Messaging abstraction.
 *
 * The engine sends DMs through this interface. Two implementations:
 *   - MockMessenger: records messages in memory (tests + local dev).
 *   - WhopMessenger: sends real DMs via the Whop SDK (production).
 *
 * Keeping this behind an interface means the engine's logic is fully testable
 * without network access, and swapping to live sending is a one-line change.
 */

export interface OutboundDm {
  companyId: string;
  userId: string;
  /** Pre-resolved DM channel, if known. */
  dmChannelId?: string;
  content: string;
}

export interface DeliveredDm {
  channelId: string;
  messageId: string;
}

export interface Messenger {
  send(dm: OutboundDm): Promise<DeliveredDm>;
}

/** In-memory messenger for tests and local dev. */
export class MockMessenger implements Messenger {
  public sent: Array<OutboundDm & DeliveredDm> = [];
  private seq = 0;

  async send(dm: OutboundDm): Promise<DeliveredDm> {
    this.seq += 1;
    const delivered: DeliveredDm = {
      channelId: dm.dmChannelId ?? `dm_mock_${dm.userId}`,
      messageId: `msg_mock_${this.seq}`,
    };
    this.sent.push({ ...dm, ...delivered });
    return delivered;
  }
}

/**
 * Production messenger backed by the Whop SDK.
 *
 * Sending a DM is a two-step call, verified against @whop/sdk:
 *   1. client.dmChannels.create({ with_user_ids: [userId] })
 *        → find-or-create the DM channel (returns existing if one exists)
 *   2. client.messages.create({ channel_id, content })
 *
 * We cache the resolved channel id on the case so step 1 only runs once per
 * member. The client is loosely typed so this file has no hard compile
 * dependency on the SDK's evolving generics.
 *
 * Docs: https://docs.whop.com/api-reference/messages/create-message
 */
export interface WhopLike {
  dmChannels: {
    create(args: {
      with_user_ids: string[];
      company_id?: string;
    }): Promise<{ id: string }>;
  };
  messages: {
    create(args: {
      channel_id: string;
      content: string;
    }): Promise<{ id?: string }>;
  };
}

export class WhopMessenger implements Messenger {
  constructor(private client: WhopLike) {}

  async send(dm: OutboundDm): Promise<DeliveredDm> {
    // Resolve the DM channel once, then reuse it for later steps.
    let channelId = dm.dmChannelId;
    if (!channelId) {
      const channel = await this.client.dmChannels.create({
        with_user_ids: [dm.userId],
        company_id: dm.companyId,
      });
      channelId = channel.id;
    }

    const res = await this.client.messages.create({
      channel_id: channelId,
      content: dm.content,
    });

    return {
      channelId,
      messageId: res.id ?? `msg_${Date.now()}`,
    };
  }
}
