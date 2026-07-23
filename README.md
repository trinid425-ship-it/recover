# Recover

**Automated churn recovery for Whop communities.**

Recover is the money-saving infrastructure layer for Whop subscriptions. It:

1. **Recovers failed payments** — when a card fails, it DMs the member a
   friendly, timed sequence with a one-tap fix link (*involuntary churn*, which
   is 20–40% of all subscription churn and largely preventable).
2. **Wins back cancellations** — when a member cancels cleanly, it runs a softer,
   offer-led win-back sequence.
3. **Flags risks** — chargebacks, refunds, and at-risk members surface as
   creator alerts before they cost more.

> One number sells this product: **"Recover saved you $X this month."**

---

## Why this exists

The Whop App Store is full of games, trading tools, and engagement toys. Almost
nobody is building the boring, high-value money infrastructure that every
subscription community needs. Failed-payment recovery is:

- **Painful & measurable** — creators watch revenue leak every month.
- **Universal** — every recurring whop (trading, coaching, communities) has it.
- **Sticky** — an app that visibly returns more money than it costs doesn't get
  uninstalled. That's low churn *for us*, too.

## How it works

```
payment.failed ─▶ [case opened] ──(4 DMs over 7 days, auto)──▶ …
      │                 │
      │                 ├─ payment.succeeded  ─▶ RECOVERED  (revenue saved ✅)
      │                 └─ sequence exhausted ─▶ LOST       (churn logged)
      └─ membership.deactivated ───────────────▶ LOST
```

1. Whop sends a `payment.failed` webhook → Recover opens a case and sends the
   first DM immediately.
2. A cron job sends the remaining dunning steps on schedule (0h / 48h / 96h /
   168h by default — fully configurable per community).
3. If the member pays (`payment.succeeded`), the case is marked **recovered**
   and the amount is counted toward recovered revenue. All further messages stop.
4. If they never pay, the case is marked **lost** after the sequence + a grace
   period, or immediately on `membership.deactivated`.

Every event is idempotent (dedup on webhook id) and signature-verified.

## Architecture

The design deliberately separates a **pure, testable core** from thin framework
adapters, so the recovery logic can be verified without any network or database.

```
src/
  core/                 ← framework-free domain logic (the IP)
    types.ts            domain types (cases, alerts, risk) + Clock
    store.ts            RecoveryStore interface + in-memory impl
    sequences.ts        dunning + win-back cadence, copy, templating
    messaging.ts        Messenger interface + Mock + Whop implementations
    engine.ts           RecoveryEngine — the state machine
    atrisk.ts           pure churn-risk scoring over engagement snapshots
    revenue.ts          ROI metrics (recovered $, recovery rate, at-risk $)
  lib/
    whop.ts             Whop SDK client + webhook verification
    mapping.ts          Whop webhook payload → normalized EngineEvent
    store-file.ts       JSON-file RecoveryStore (swap for Postgres in prod)
    engagement.ts       engagement-data provider seam for at-risk scan
    runtime.ts          assembles engine from env (mock vs. live messenger)
  app/
    api/webhooks/whop/  verified webhook receiver
    api/cron/process/   sends due dunning + win-back steps
    api/cron/at-risk/   daily at-risk scan
    dashboard/          the ROI surface the creator sees inside their whop
test/
  simulate.ts           end-to-end simulation (25 assertions, 5 scenarios)
  seed.ts               populates demo data for the dashboard
```

Because `RecoveryEngine` takes its store, messenger, and clock as injected
dependencies, the whole lifecycle runs deterministically in `test/simulate.ts`.

## Run it

```bash
npm install
npm run simulate     # runs the lifecycle test — 15/15 should pass
npm run dev          # Next.js app; open http://localhost:3000/dashboard
```

`MESSENGER_MODE=mock` (default) logs DMs instead of sending them, so you can run
the full flow locally with no credentials.

## Going live (integration checklist)

1. **Create an app** in the Whop dashboard → Developer tab → *Create app*.
   Copy the App API key into `WHOP_API_KEY`.
2. **Deploy** (Vercel is easiest). Set `APP_BASE_URL` to the deployed URL.
3. **Create a webhook** (Developer tab → Create Webhook) pointing at
   `https://<your-app>/api/webhooks/whop`, API version `v1`, subscribed to:
   `payment.failed`, `payment.succeeded`, `membership.deactivated`,
   `dispute.created`, `refund.created`.
   Copy the signing secret into `WHOP_WEBHOOK_SECRET`.
4. **Schedule the crons** (Vercel config below):
   - `POST /api/cron/process` every ~15 min — sends due dunning/win-back steps.
   - `POST /api/cron/at-risk?company=<id>` daily — runs the at-risk scan.
   Both require header `Authorization: Bearer $CRON_SECRET`.
5. **Wire engagement data** in `src/lib/engagement.ts` to enable at-risk scoring
   (the scorer is done and tested; it just needs live activity data).
6. Set `MESSENGER_MODE=whop` and you're live.

### Vercel cron (vercel.json)

```json
{
  "crons": [
    { "path": "/api/cron/process", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/at-risk", "schedule": "0 9 * * *" }
  ]
}
```

## Free hosting (no paid plan needed)

You can run Recover entirely on free tiers:

- **Host:** Vercel **Hobby (free)** — the app, webhook receiver, and dashboard
  all work. No card required.
- **Frequent cron:** Vercel Hobby only runs crons **once per day**, so the
  every-15-min dunning processor is triggered by a **free external scheduler**
  instead. Use [cron-job.org](https://cron-job.org) (free, supports custom
  headers + minutely schedules):
  - URL: `https://<your-app>/api/cron/process`
  - Method: `GET`
  - Header: `Authorization: Bearer <your CRON_SECRET>`
  - Schedule: every 15 minutes
  - (GitHub Actions on a `*/15` schedule works too, also free.)
- **Daily at-risk scan:** handled by Vercel's own once-daily cron (already in
  `vercel.json`) — valid on the free plan.
- **Database:** the JSON file store works for launch/low volume. When you
  outgrow it, free Postgres tiers (Neon, Supabase) drop in behind the same
  `RecoveryStore` interface.

Net: **$0/month** to get live and start recovering revenue.

## What's built

| Capability | Trigger | What it does | Status |
|---|---|---|---|
| Failed-payment recovery | `payment.failed` → `payment.succeeded` | Timed dunning DMs + one-tap fix link | ✅ |
| Win-back | `membership.deactivated` (voluntary) | Softer offer-led resubscribe sequence | ✅ |
| Chargeback alerts | `dispute.created` | Critical creator alert to respond fast | ✅ |
| Refund alerts | `refund.created` | Warning alert to watch refund trends | ✅ |
| At-risk detection | daily scan | Scores engagement, alerts on high risk | ✅ scorer / ⏳ data source |
| ROI dashboard | — | Recovered $, rate, win-backs, alerts | ✅ |

## Roadmap (phase 3)

- **A/B testing** of copy + cadence per community.
- Creator-facing **config UI** (copy, timing, on/off) — `CompanyConfig` already
  supports overrides.
- Fitted churn model behind the `assessRisk` interface once data accrues.

## Status

- ✅ Full suite built: recovery + win-back + alerts + at-risk scoring
- ✅ **25/25 lifecycle assertions passing** (`npm run simulate`)
- ✅ Signature-verified webhooks, idempotent event handling
- ✅ ROI dashboard with alerts + win-back tracking
- ⏳ Live Whop credentials, deploy, and engagement-data wiring (checklist above)
