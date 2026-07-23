/**
 * Whop-embedded member view: /experiences/[experienceId].
 *
 * Recover mostly works in the background (it DMs members when a payment fails),
 * so the member-facing surface is intentionally simple: a reassuring, branded
 * page confirming their membership is protected. We verify the Whop token to
 * greet the viewer, but show the page to any valid member.
 */

import { verifyWhopViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Experience({
  params,
}: {
  params: Promise<{ experienceId: string }>;
}) {
  await params; // experienceId available if we later personalize per-experience
  const viewer = await verifyWhopViewer();

  return (
    <main
      style={{
        minHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 40,
        gap: 6,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/recover-icon.png" alt="Recover" width={96} height={96} />
      <h1 style={{ fontSize: 24, margin: "12px 0 0" }}>
        Your membership is protected
      </h1>
      <p style={{ color: "#9aa4b2", lineHeight: 1.7, maxWidth: 440 }}>
        {viewer ? "You're all set. " : ""}
        If a payment ever fails, Recover will quietly send you a one-tap link to
        fix it so you never lose access over an expired card. Nothing for you to
        do — we've got it covered.
      </p>
    </main>
  );
}
