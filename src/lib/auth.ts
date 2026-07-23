/**
 * Whop embedded-app authentication.
 *
 * When Whop renders our app in an iframe it attaches an `x-whop-user-token`
 * JWT identifying the viewer. We verify it against Whop's public keys (via the
 * SDK) to get the viewer's userId, then check their access level to the company
 * or experience so a creator only ever sees their own data.
 *
 * Docs: https://dev.whop.com (embedded apps / user tokens)
 */

import { headers } from "next/headers";
import { whopClient } from "./whop";

export interface WhopViewer {
  userId: string;
  appId: string;
}

/** Verify the Whop iframe token from the incoming request headers. */
export async function verifyWhopViewer(): Promise<WhopViewer | null> {
  try {
    const h = await headers();
    const token = h.get("x-whop-user-token");
    if (!token) return null;
    const res = await whopClient().verifyUserToken(token, { dontThrow: true });
    return res ?? null;
  } catch {
    return null;
  }
}

export type AccessLevel = "no_access" | "admin" | "customer";

/**
 * Access level of `userId` to a resource (company id, experience id, etc.).
 * - "admin"    → the creator / team member (sees the recovery dashboard)
 * - "customer" → a member (sees the experience view)
 * - "no_access"→ neither
 */
export async function accessLevel(
  userId: string,
  resourceId: string,
): Promise<AccessLevel> {
  try {
    const res = await whopClient().users.checkAccess(resourceId, { id: userId });
    return (res.access_level as AccessLevel) ?? "no_access";
  } catch {
    return "no_access";
  }
}
