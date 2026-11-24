# AGENTS.md — Petcom Ticketing + CRM

> **This is the project's memory.** Read it first, at the start of every session.
> Update it at the end of every session (§11 says how). It is the only continuity between sessions —
> if it isn't written here, it didn't happen.

| | |
|---|---|
| Client | Petcom (Pet Community Events) |
| Owner | Hansh |
| Source plan | `C:\Users\eddie\Desktop\PETCOM_PLATFORM_PLAN.md` (630 lines, authoritative) |
| Working dir | `C:\Users\eddie\Desktop\petcom nocodb` |
| Platform | Windows, PowerShell, OpenCode |
| Status | **Phase 1 running locally** — Next.js app on Postgres covering online checkout, QR tickets, scanner, counter sales and cash approval. Not deployed; email/WhatsApp legs still stubbed |
| Last updated | 2026-11-19 |

---

## 1. What this is

Petcom runs pet events. Today each event means a hand-built HTML page, Razorpay Payment Links, a Google
Sheet, and a QR scanner — the Diwali page (`diwali-with-pets.petcom.in`, 25 slots) is the template for
that pain. This project turns that one-off into a reusable platform: sell tickets online and offline,
issue a QR ticket per attendee, scan at entry, and keep a CRM of every lead — so adding an event becomes
data entry, not a code change.

Eight goals, in the client's words (§1 of the plan):

1. Sell online + offline, one QR per attendee, scan at entry.
2. CRM capturing every lead, even unpaid — source, stage, purchases, repeat behaviour.
3. Meta Pixel + server-side CAPI with all attribution stored.
4. Ticket + reminders + announcements over email / WhatsApp / SMS.
5. New event = data entry, not a deploy.
6. Non-technical owner and staff work in a spreadsheet-like UI.
7. Owner self-service: list an event, click Publish, everything is live.
8. Safe change/cancellation handling with refunds back to the original payment source.

## 2. Decisions already made — do not re-litigate

| # | Decision | Why |
|---|---|---|
| 1 | **v1 schema was built in NocoDB first**, then rebuilt in Postgres — see #11 | Original instruction: "build out the first version of it in nocodb using the mcp connection". That delivered the field-level design (`NOCODB_SCHEMA.md`) but could not deliver transactions, so the running app uses Postgres and the NocoDB base is now a frozen reference. |
| 2 | **NocoDB auto-increment integer `Id`**, not the plan's `uuid` | NocoDB owns the primary key; fighting it buys nothing. Idempotency lives in the unique text columns (`qr_token`, `razorpay_order_id`, `idempotency_key`), which is where it actually matters. |
| 3 | **`CreatedAt` / `UpdatedAt` are NocoDB system fields** | Authored `created_at`/`updated_at` columns would duplicate them. |
| 4 | **All relations are `mo` (many-to-one) from the child** | NocoDB auto-creates the reverse field, so `customers` becomes the CRM hub with orders/tickets/messages/activity attached. |
| 5 | **`customers.tags` and `customer_activity.type` are free text**, not selects | The plan generates dynamic values (`cancelled-<event>`) that a fixed choice list would reject. |
| 6 | **Views are built by `duplicateView`, not `createView`** | `createView` and `updateView` are broken in this NocoDB build (§7). Duplicate copies filters and accepts a title. |
| 7 | **Secrets live in files, never in `opencode.jsonc`** | `.nocodb-token` (bare token, no trailing newline) referenced as `{file:./.nocodb-token}`; `.env` holds `NOCODB_API_KEY` for humans. Both gitignored. |
| 8 | **Token id stays `ncd9flwpnci3ln6a` when rotating** | NocoDB keeps the id and rotates only the secret. The MCP URL therefore never changes. |
| 9 | **Cash and comp at the counter never issue a ticket directly** | Direct instruction. A cash sale opens an approval request in the admin panel; no QR token is minted, no ticket page exists, nothing is sent until the owner approves. `orders.approval_status` drives it, so a pending sale is still an order and needs no special case in inventory or refunds. UPI/card keep issuing instantly because Razorpay, not a person, confirms the money. |
| 10 | **The seller can never approve their own sale** | Otherwise the approval is theatre — the person holding the cash would be the person confirming it arrived. Checked server-side, not by hiding a button. |
| 11 | **Postgres is the source of truth; NocoDB becomes a viewer** | D1 of `FRONTEND_PLAN.html` accepted by the instruction "build the first version". SQLite-in-NocoDB could not do `SELECT … FOR UPDATE` or a real transaction, and the cash hold race is exactly what those protect. Postgres 16 in Docker `petcom-pg` on port 5433. The NocoDB base stays as the design reference and is not written to by the app. |
| 12 | **Auth is email + 6-digit code, printed to the server console; the cookie is re-validated against `staff` on every read** | No SMTP in v1, so the code goes to the terminal rather than pretending to send mail. The HMAC cookie carries the staff id, but the role and the `active` flag are re-read from the database on every `getSession()`, so deactivating or demoting someone takes effect immediately instead of when the cookie expires. |
| 13 | **One payment path: provider interface (`mock` \| `razorpay`) → idempotent `markPaid`** | `PAYMENTS_MODE=mock` is the default so the whole lifecycle — hold, pay, QR, scan — runs without keys. The mock deliberately calls the same `markPaid` a webhook would, so test mode cannot diverge from live. |
| 14 | **Public access to a ticket is by `qr_token` only** | There is no `/order/[id]` page. Sequential ids would let anyone enumerate other people's names, phones and emails. The ticket token is 128 bits and is the only key. |
| 15 | **Publishing an event is a separate click from creating it** | `createEvent` writes `status = 'draft'`, which is invisible on `/`. `setEventStatus` publishes. Otherwise a half-typed event page is live the moment the form is saved. |
| 16 | **The repo is private under `eddie-hdtv`, branch `main`; `HanshGoyal` has write access** | Client code and a live Razorpay key id exist in this project's history elsewhere (plan §12), so it stays private. `main` is the only branch — trunk-based, no long-lived dev branch. |

### Non-negotiables (from §15 — these outrank convenience)

- Payment is confirmed **server-side only**: verified signature **plus** a server-side Razorpay fetch (`captured`, amount matches).
- `markPaid` must be **idempotent** — the callback and the webhook both call it.
- Inventory and check-in are **atomic** (`UPDATE ... WHERE ... RETURNING`). Never two code paths writing stock.
- **No secrets in the client.** NocoDB is never called from the browser.
- Schema ships as **versioned SQL migrations** in the repo — not `drizzle-kit push` — before anything is deployed. (Postgres is here; the migrations are the outstanding half of this promise.)

## 3. Architecture

### Target (plan §3)

```
 Visitor --> Next.js on Vercel (/e/[slug], /ticket/[token], /api/*)
                |            |              |
            Razorpay     Meta CAPI      Messaging (Resend / WhatsApp BSP / SMS)
                |
                v
        Postgres (source of truth) <--> NocoDB (CRM + power UI)
                ^
 Staff phone -> Scanner PWA (/scan) -> /api/check-in
 Owner/staff -> Admin panel (/admin)  -> publish, pricing, live sales, broadcasts
```

### As built today

```
 Customer  --> Next.js 16 (App Router) on localhost:3000
                 |  server actions + /api/check-in, /api/payments/*, /api/webhooks/razorpay
                 v
          Postgres 16 (Docker petcom-pg, port 5433)  <-- Drizzle ORM, single writer
                 ^
                 | read-only reference (not connected yet)
             NocoDB base (SQLite, design reference)
```

Everything runs locally. No deployment, no Razorpay keys, no email/WhatsApp provider, no Meta CAPI.
The mock payment provider exercises the exact production code path.

### Stack — target vs. now

| Layer | Target | Now |
|---|---|---|
| Frontend + API | Next.js (App Router) on Vercel | Next.js 16.4.5 + React 19, TypeScript strict, Tailwind v4 — running locally |
| Database | Postgres (Neon/Supabase free tier) | Postgres 16 in Docker `petcom-pg` (port 5433), Drizzle schema + `drizzle-kit push` |
| CRM / power UI | NocoDB pointed at the same Postgres | NocoDB standalone, zero rows, not connected to app data |
| Admin panel | `/admin` in the same Next.js app, shadcn/ui + RHF + Zod | `/admin` built by hand (no component library), server components + `useActionState` forms |
| Auth | Auth.js or Supabase Auth, phone OTP / magic link, roles in `staff` | Email + 6-digit code printed to the console; HMAC cookie; roles owner/sales/scanner |
| Files | Cloudflare R2 / Vercel Blob / Supabase Storage, auto-resized | — (no uploads yet; `assets` table unused) |
| Payments | Razorpay: Payment Links now, Orders API + Checkout after website approval | Provider interface with `mock` (default) and `razorpay` (Orders API + verify route); webhook written, untested against live |
| Email | Resend or AWS SES | — (ticket email is queued into `messages`, nothing sends it) |
| WhatsApp | BSP (AiSensy / Interakt / Gupshup) or Meta Cloud API — templates pre-approved | — |
| SMS | MSG91, DLT-registered — fallback only | — |
| Automation | n8n self-hosted or Vercel Cron; `scheduled_jobs` + `SKIP LOCKED` | `/api/cron/expire` sweeper (holds, approvals, stale-approval alerts); no queue worker |
| Monitoring | Sentry + Razorpay webhook logs + uptime | — |

Running cost estimate: ~₹500–1,500/month (VPS + messaging) plus Razorpay fees.

## 4. Data model

### Live: Postgres (`lib/db/schema.ts` is authoritative)

24 tables, created with `npm run db:push` (`drizzle-kit push --force`):

- The 20 from plan §4, unchanged in intent: `events`, `ticket_types`, `orders`, `tickets`, `payments`,
  `refunds`, `customers`, `customer_activity`, `staff`, `message_templates`, `messages`,
  `event_automations`, `scheduled_jobs`, `event_templates`, `assets`, `event_changes`,
  `change_responses`, `owner_alerts`, `tracking_events`, `audit_log`.
- Four added for this app: `auth_users` (email allow-list per staff), `auth_sessions` (issued OTP
  sessions), `otp_codes` (hashed 6-digit codes, expiry, attempts), `webhook_events` (provider event
  id unique — webhook dedup before `markPaid` runs).
- `orders` carries the five approval columns from §09: `approval_status`, `approved_by`, `approved_at`,
  `approval_expires_at`, `rejection_reason`.

Money is integer paise. Relations are real FKs; uniqueness that matters is in the database
(`tickets.qr_token`, `orders.razorpay_order_id`, `refunds.idempotency_key`,
`webhook_events(provider, provider_event_id)`, `otp_codes(code_hash)` indexing).

### Reference: NocoDB base (frozen, empty)

Base `Petcom` → `p4k50suef4oc1gn`, workspace `wwj643se`.
Open: http://localhost:8080/wwj643se/p4k50suef4oc1gn

| Table | ID | Purpose |
|---|---|---|
| `events` | `m5zkofng4lyjyoi` | One row per event; drives page, checkout, scanner, automations |
| `ticket_types` | `mbq3mkynvk4vf3o` | Price tiers per event |
| `orders` | `m9fmtvw226gx5tu` | Purchase attempt; holds inventory until paid/expired |
| `tickets` | `ma42nfhcsbjb6hx` | One row per attendee; QR check-in is one atomic update |
| `payments` | `mxo0jtn9o0tsm8g` | Razorpay payments + raw webhook |
| `refunds` | `m6rnysm9lz7r9hs` | Refund queue; `idempotency_key` blocks double refunds |
| `customers` | `mrrf3z6wuf5jg2j` | Leads/contacts, keyed by phone |
| `customer_activity` | `mwzb0f3yfc7rj3d` | Per-customer timeline |
| `staff` | `m9c7bw2oindx7oy` | Owner / sales / scanner accounts |
| `message_templates` | `mfqbtjn5muk3u9i` | Message bodies + provider template id |
| `messages` | `m3uibfkt6lbkfri` | Every send attempt and its status |
| `event_automations` | `mk4rtwydi9m1pci` | Which notifications fire per event |
| `scheduled_jobs` | `mspozjwtdxzwqry` | Automation queue drained by the worker |
| `event_templates` | `mkw4ixqd1nhymxr` | Starting points for event creation |
| `assets` | `mjqb9lztc47pam2` | Uploaded images per event |
| `event_changes` | `mk4zgp1hqj8bbvp` | Reschedule / venue / postpone / cancel, versioned |
| `change_responses` | `ms9e9cuyaj1yf7r` | Consent + acknowledgement per ticket per change |
| `owner_alerts` | `m1vibd7zqrxrxfe` | Alerts the owner must see |
| `tracking_events` | `mzehdqp2f3vb2y9` | Pixel/CAPI log with dedup ids |
| `audit_log` | `mfhxq4x8l80earo` | Who changed what, when |

Field-level detail, every relation, and the deviations from §4 are in **`NOCODB_SCHEMA.md`** — treat that
file as the NocoDB reference and keep it in sync. For the live database, `lib/db/schema.ts` wins.

The NocoDB base still has zero rows; the app has never written to it. `npm run db:seed` seeds Postgres only.

## 5. Views

| Table | View | Config |
|---|---|---|
| customers | All customers | no filter |
| customers | Sales by source | sorted by `utm_source` |
| customers | Repeat attendees | `stage = repeat`, sorted by `name` |
| customers | Marketing consented | `consent_marketing` checked |
| tickets | All tickets | no filter |
| tickets | Today's check-in list | `status = valid`, sorted by `holder_name` |
| tickets | No-shows | `status = valid` (sold, never scanned) |
| orders | All orders | no filter |
| orders | Offline sales | `sold_by` not empty |
| orders | Paid orders | `status = paid` |

Still missing, because the platform can't create them (§7): **Leads pipeline kanban by `stage`** and
**offline sales form**. Both are two clicks in the NocoDB UI. Grouping (e.g. Sales by source *grouped* by
`utm_source`) is also unavailable — sorted is the closest we get.

## 6. Task list

### Done

- [x] MCP connection diagnosed and fixed (see §12)
- [x] `.gitignore`, `.env`, `.nocodb-token`, `opencode.jsonc` — secret wired without being committed
- [x] All 20 tables from plan §4 with relationships
- [x] Reverse fields verified (`customers.orders`, `orders.tickets`, `tickets.refunds`, …)
- [x] 10 usable views via `duplicateView` + filters/sorts
- [x] `NOCODB_SCHEMA.md` written
- [x] `AGENTS.md` written
- [x] `createFilter` / `addSort` / `duplicateView` / `deleteView` verified against the live base
- [x] **Postgres schema live** — 24 tables pushed with Drizzle (`petcom-pg` on port 5433), including the five `orders` approval columns
- [x] **Domain layer with the non-negotiables enforced** — atomic holds, idempotent `markPaid`, atomic check-in, seller-cannot-self-approve, audit writes in the same transaction
- [x] **v1 app** — `/`, `/e/[slug]`, `/checkout/[id]`, `/ticket/[token]`, `/login`, `/sell`, `/sell/order/[id]`, `/scan`, `/admin{,/approvals,/orders,/events}`
- [x] **Tests: 20 passing** (`npx vitest run`) — last-seat race (20 buyers, 1 winner), payment idempotency (3 deliveries → 1 ticket set), 10 parallel scans, self-approval refused, hold expiry
- [x] **Seed script** (`npm run db:seed`) — Diwali with Pets, 2 tiers, 3 staff accounts, 3 message templates; safe to run twice
- [x] **Playwright walkthrough** on the running app: online buy → mock pay → ticket QR → counter cash sale → pending with no QR → owner approval mints tickets → scan admits → rescan refused → event draft → publish
- [x] **Re-verified end to end 2026-11-05** after the Postgres outage: login → checkout → mock pay → QR ticket → admit → rescan refused → admin ₹299 paid; 20/20 tests, typecheck clean (see §12)
- [x] **Committed and pushed 2026-11-19** — private repo `https://github.com/eddie-hdtv/Petcom`, branch `main`, one initial commit, 74 files, no secrets (`.env`, `.nocodb-token` ignored). `HanshGoyal` invited as a write collaborator (invite pending his acceptance)

### Next (in order)

- [ ] **Deploy** — Vercel + hosted Postgres (Neon/Supabase); set `SESSION_SECRET`, `APP_URL`, `NEXT_PUBLIC_BASE_URL`; run `db:push` + `db:seed` there
- [ ] **Real Razorpay** — set `PAYMENTS_MODE=razorpay` + keys, register the webhook URL, run one live ₹1 test, confirm `payment.captured` → `markPaid` → ticket
- [ ] **Email the ticket** — the `messages` row is queued but nothing sends it; Resend is the smallest step
- [ ] **Point NocoDB at the same Postgres** (D1 follow-through) so the owner gets the spreadsheet-like UI without a second source of truth
- [ ] **Refunds / cancellation** (Phase 3) — `refunds` and `event_changes` tables exist and are unused
- [ ] Create the kanban and form views in the NocoDB UI (§5)
- [ ] **Protect the NocoDB data**: the container has no volume (§7). Snapshot or re-create it with a volume before real data goes in
- [ ] Start the slow external approvals (WhatsApp verification + template approval, DLT registration, Razorpay website review) — the plan says day 1
- [ ] Copy the GitHub / Vercel / commit-author account rules from the Diwali handoff into this file (plan §13, §15) — **not yet supplied**
- [x] **`predev` guard and `agentRules: false`** (2026-11-05) — `npm run dev` starts `petcom-pg` and waits for `pg_isready`; Next no longer rewrites this file

### Blocked / waiting on the client

- Ledger of plan §14 open questions — see §8. Phase 1 cannot be designed properly without Q1, Q4, Q6, Q7.

### Deliberately ignored

- `zz_mcp_connection_test` — throwaway connection probe, deleted by the user. Do not recreate.
- `zz_view_probe` — throwaway view probe, deleted. Do not recreate.
- Raw REST paths under `/api/v2/meta/...` — returned 404 and are version-specific. Use the MCP tools; do not chase endpoints with curl.
- Trying to change a view's type via `updateView` — impossible in this build; don't waste another 60-second timeout on it.
- Re-testing whether `createView` has "fixed itself" — three isolation attempts already proved it deterministic.
- The Diwali `AGENTS.md` that contains a live Razorpay key id (plan §12) — keep it out of any shared repo; do not copy its secrets here.
- Building a public `/order/[id]` page — sequential ids leak names, phones and emails. Tickets are reached by `qr_token` only (§2 #14).
- Trusting the role in the session cookie — it is re-read from `staff` on every request (§2 #12). Do not "optimise" that query away.
- Rewriting the raw `sql` subqueries in `lib/queries.ts` to interpolate `${events.id}` — that is the bug, not the style (§7).

## 7. Known issues and gotchas

### `next dev` truncates this file at the first literal agent-rules marker

`next dev` rewrites the Next.js agent-rules block at the bottom of `AGENTS.md` on startup. In Next 16.4.5 it
does not find the block — it finds the **first occurrence of that marker anywhere in the file** and replaces
everything from there to EOF. Because §7 used to mention the marker inline in a bullet, every `npm run dev`
silently deleted §8–§14 (open questions, phases, conventions, session log, files, environment facts).

Evidence: `AGENTS.md` had `LastWriteTime` equal to the second the dev server started, was 22,853 bytes
instead of ~60k, ended mid-sentence, and had only `## 1`…`## 7`.

**Fixed 2026-11-05:** `next.config.ts` now sets `agentRules: false`, so `next dev` no longer creates or
updates that block at all — it removed the managed block once on the next start and left the rest of the
file alone. The file is hand-maintained. If anyone re-enables `agentRules`, re-read this section first: any
inline copy of the marker turns the next dev start into a truncation from that line to EOF.

### `createView` and `updateView` are broken in NocoDB `2026.10.1`

Every call blocks ~60 s, then fails:

```
Error: Failed to create View
KnexTimeoutError: Timeout acquiring a connection. The pool is probably full.
```

Proven not transient: reproduced after `docker restart`, on multiple tables, with and without `options`,
and on a fresh one-field probe table. Reads answer in ~140 ms and `createTable`, `createRecords`,
`createFilter`, `addSort`, `duplicateView`, `deleteView` all work — so it is the view write path, not the
pool or the connection.

Workarounds in use: `duplicateView` (+ title) to get a new view; `deleteView` on the old default to
"rename"; filters and sorts for behaviour. **Not** possible: kanban, form, calendar, gallery, grouping.

### The container has no volume — this is a data-loss trap

`docker inspect keen_lamport` → `Mounts: []`, `RestartPolicy: no`. The SQLite DB (`/usr/app/data/noco.db`)
lives in the container's writable layer. `docker rm` deletes the entire base.

```powershell
docker commit keen_lamport petcom-nocodb:backup   # snapshot before touching the container
# or re-create it properly:
#   -v petcom_nocodb:/usr/app/data --restart unless-stopped
```

### Drizzle drops the table qualifier in raw `sql` templates

`sql\`... ${events.id} ...\`` renders **`"id"`, unqualified**. Inside a subquery that silently binds to the
*inner* table's `id`, so the query runs, returns a number, and the number is wrong:

```sql
-- what you get, not what you meant
(select count(*) from tickets t where t.event_id = "id")
```

Every correlated subquery in `lib/queries.ts` therefore writes the table name literally
(`events.id`, `orders.id`, `orders.approved_by`). Symptom seen: `/admin/events` reported
`tiers 1 / sold 1` for an event with 2 tiers and 3 tickets. If a count looks plausible but low, check this
first. `q.toSQL()` in a throwaway script is the fastest way to see it.

### `"use server"` files may only export async functions

Next 16 fails the build at "collecting page data" with `Failed to collect configuration for /admin/events`
if a `"use server"` module exports a plain value:

```
Error: Failed to collect configuration for /admin/events
```

So `export const emptyCheckoutState = { error: null }` cannot live beside the action. Initial states are
inline literals at the `useActionState` call site instead. The error names a *page*, which makes it look
like a page bug — it is not.

### Tests truncate the entire database

`tests/global-setup.ts` truncates every table on teardown, and each suite truncates before running. That is
what keeps the dev DB clean, but it also means `npx vitest run` destroys whatever is in the database named
by `DATABASE_URL`. Never point it at data you care about; re-seed with `npm run db:seed` afterwards.

### Tailwind utilities lose to the custom classes in `globals.css`

`.pill { display: inline-flex }` and `.btn { display: inline-flex }` are unlayered CSS, so they beat
Tailwind's layered utilities: `hidden` / `sm:inline-flex` on a `.pill` do nothing. Use the important
modifier (`!hidden sm:!inline-flex`) as the rest of the code already does for `!min-h-9`. This showed up as
a "needs approval" pill that refused to hide on mobile.

### Postgres stopped = 500 on every page, and it looks like an app bug

If the stack "breaks" after a reboot, a Docker Desktop restart, or a long pause, check Docker before reading
any TypeScript. The symptom on 2026-11-05 was:

```
connect ECONNREFUSED ::1:5433
Failed query: select ... from "events" where "events"."status" in ($1, $2, $3)
```

`docker ps` showed `petcom-pg Exited (137)` and the container log ended with a clean
`received fast shutdown request`. `docker start petcom-pg` fixed it with no code change.

### Smaller ones

- Checkboxes come back as `1`/`0`, not `true`/`false`.
- `duplicateView` copies the source view's filters — clear them on the copy if it should show everything.
- Deleting a table's first collaborative view promotes the next one; NocoDB always keeps a default view.
- My earlier probe left a `status = valid` filter on the tickets default view; it's intentional now, but it's why "All tickets" had to have one deleted.
- `getBaseSchema` returns fields with `title: null` (different shape from `getTableSchema`) — use `getTableSchema` when you need field titles/ids.
- Global OpenCode config `C:\Users\eddie\.config\opencode\opencode.jsonc` also lists `blender-mcp`, which is broken (missing `uvx.exe`). Unrelated to this project; leave it alone.
- Windows user env var `NOCODB_API_KEY` was persisted with `setx`, but OpenCode does **not** load `.env` and the background service froze its env at startup — the `{file:...}` reference is what actually works.
- Next 16: `params` and `searchParams` are **Promises** — `await` them in every page. `redirect()` inside a server action throws `NEXT_REDIRECT`, so a `catch` must rethrow anything that is not a `DomainError` or the redirect is swallowed and the form silently does nothing.
- `.next/dev/types` gets added to `tsconfig.json` by `next build`, and `next dev` rewrites the Next.js agent-rules block at the bottom of this file. Both are expected churn; keep them.
- Playwright MCP writes `.playwright-mcp/` and screenshots into the repo root. Both are gitignored now (`/*.png` at root only, so app images later are still tracked).
- There is no `app/icon.*` and no `public/`, so the browser logs `GET /favicon.ico 404`. Cosmetic only.

## 8. Open questions (plan §14 — Q1 answered, the rest open)

These block real progress. Ask before designing Phase 1.

| # | Question | Why it matters |
|---|---|---|
| Q1 | ~~**Postgres + NocoDB, or NocoDB-only?**~~ → **answered 2026-11-04: Postgres is the source of truth, NocoDB becomes a viewer** (§2 #11). Remaining sub-question: when NocoDB is pointed at the same Postgres, does it get write access or read-only? | Changes Phase 0 setup and every later decision about transactions |
| Q2 | NocoDB hosting: VPS (₹500–800/mo) or Railway? | Ops burden |
| Q3 | How many staff use the CRM and scanner? Which roles? | Auth model |
| Q4 | Is the Razorpay website review approved? | Payment Links vs. Checkout popup for launch |
| Q5 | Typical event size and frequency? | How much offline scanner work is worth building |
| Q6 | Refund and transfer policy — can tickets change hands? | Ticket model |
| Q7 | GST and invoicing required? | Receipts, pricing display, refund accounting |
| Q8 | Which WhatsApp provider, and is there a verified business number? | Messaging leg |
| Q9 | Owner's devices — phone only, or laptop too? | How mobile-first the admin has to be |
| Q10 | Can sales staff create drafts, or does the owner publish alone? | Permissions |
| Q11 | One Petcom brand for all events, or per-event themes? | Design system |
| Q12 | Refund policy on cancellation / reschedule / change of mind? | Refund rules |
| Q13 | Who bears the gateway fee on refunds? GST implications? | True cost of a cancellation |
| Q14 | Cancellation release: auto-refund, or review then release? | Cancellation flow default |
| Q15 | No-response default after a change: keep valid, or auto-refund? | Plan recommends keep valid |
| Q16 | Owner alert channels, and is there a second person to alert? | `owner_alerts` delivery |

## 9. Build phases (plan §13) — tick as they complete

- **Phase 0 — Setup (1–2 days).** Repo, Vercel, accounts · Postgres + NocoDB on it · *start WhatsApp/DLT/Razorpay approvals today* · `AGENTS.md` · schema migrations.
  **Acceptance:** owner logs into NocoDB and sees empty events, customers, orders, tickets tables. → **Schema half done in NocoDB; Postgres schema now live and pushed with Drizzle. Repo not committed, nothing deployed, approvals not started.**
- **Phase 1 — Core ticketing MVP (~1 week) URGENT.** `/e/[slug]`, checkout with inventory hold, Razorpay + idempotent `markPaid`, ticket page with QR, email ticket, scanner v1 online, migrate Diwali sheet data.
  **Acceptance:** buy in test mode → email → scan admits → rescan says used → fake QR rejected → two parallel buyers for the last slot, exactly one wins.
  → **Everything but email passes locally** (the last-seat race is a test, not a demo: 20 concurrent buyers, 1 winner). Email is queued to `messages` and never sent, so the acceptance line is not met yet. Razorpay is wired but has never run against a live key. Diwali sheet not migrated.
- **Phase 2 — Owner admin + automation (~1.5 weeks).** Auth/roles/audit, event wizard with templates and live preview, image pipeline, pricing editor, `publishEvent()` with revalidation, automation engine with `SKIP LOCKED`, dashboard, live event mode.
  **Acceptance:** owner alone, on his phone, creates and publishes a paid workshop from a template; page live within a minute; test purchase works; reminders scheduled; moving the date reschedules jobs.
- **Phase 3 — Changes, cancellation, refunds (~1 week).** Material-change detection, `applyEventChange()`, response capture, updated `.ics` (same UID, higher SEQUENCE), `cancelEvent()`, Razorpay refunds with idempotency, reconciliation, alerts, manual refunds, unreachable list.
  **Acceptance:** the 5-online/2-offline scenario in §13, including replaying a webhook twice and refunding from the dashboard instead of the panel.
- **Phase 4 — CRM and offline sales (~1 week).** Lead capture before payment, UTM/fbclid into customers, the four NocoDB views, offline sales form + cash reconciliation, UPI counter flow.
  **Acceptance:** staff sells 5 offline tickets from a phone; they appear in the same dashboard as online sales; counts match.
- **Phase 5 — Messaging and tracking (~1 week).** WhatsApp delivery + reminders, SMS fallback, `messages` log + failure view, Pixel + CAPI with dedup, consent/opt-out, scanner PWA offline mode.
  **Acceptance:** Events Manager shows deduplicated `Purchase`; WhatsApp automations deliver; airplane mode still admits tickets and syncs later.
- **Phase 6 — Growth (ongoing).** Broadcast composer, abandoned-checkout nudges, Razorpay Checkout popup, discount/partner codes, waitlist, show-up/repeat/LTV reports, multi-event dashboards, surveys.

**Rule from the plan: do not start a phase before the previous acceptance test passes.**

## 10. Conventions

- Money is **integer paise** everywhere (`price_paise`, `total_paise`, `lifetime_value_paise`). Never floats.
- Times stored **UTC**, displayed **IST**, messages always say IST.
- `qr_token` ≥ 128 bits of randomness, unique.
- Every admin write lands in `audit_log`.
- Public ticket endpoints return **masked** PII only.
- Idempotency keys on checkout submission, refunds, and automation jobs `(event_id, automation_key, ticket_id)`.
- Owner-facing flows are mobile-first with big touch targets; the owner mostly uses a phone.
- Write the migration and the test first, then the code (plan §15).
- **The database is the only writer.** Pages read through `lib/queries.ts`; every write goes through a server action or route handler into a domain module that opens its own transaction. No page writes, no route writes SQL directly.
- **A hidden button is not a permission.** Role and ownership are re-checked inside the domain function (`approveSale`, `createCounterSale`, `setEventStatus`), because a server action is a public endpoint with a form attached.
- **Everything the browser holds is guessable.** Session cookies are signed; ticket URLs carry 128-bit tokens; there is no `/order/[id]`.

## 11. How to maintain this file

At the end of each working session, **before you report back**:

1. Append a dated entry to §12 — what was asked, what was done, what broke, what was decided. Never delete old entries; strike through instead.
2. Move finished items in §6 from Next to Done; add newly discovered blockers.
3. Add any new decision to §2 **with its reason** — the reason is the part that stops it being re-argued.
4. Add new traps to §7 the moment you hit them, with the failing command or error text.
5. Tick phase boxes in §9 only when the acceptance test actually passes.
6. Update `NOCODB_SCHEMA.md` too if the schema changed.
7. **Never write a secret value in this file** — paths and file names only.
8. **Do not re-enable `agentRules` without reading §7 first.** It is off in `next.config.ts` because the generator truncated this file at the first marker it found.

## 12. Session log

### 2026-11-19 — Private GitHub repo, initial push, collaborator

**Asked:** create a private GitHub repo named `Petcom`, push the project, invite `https://github.com/HanshGoyal`.

- Nothing was tracked before this. Staged all 74 files, confirmed `.env`, `.nocodb-token`, `node_modules/`, `.next/` were **not** staged, committed as `ed0504f` ("feat: initial Petcom ticketing and CRM platform"), renamed `master` → `main`.
- `gh repo create Petcom --private --source=. --remote=origin --push` → `https://github.com/eddie-hdtv/Petcom`. Verified: `visibility: PRIVATE`, default branch `main`, 74 blobs on origin.
- Invited `HanshGoyal` with `write` (push) permission via the collaborators API. Invite is **pending his acceptance** — it is not access until he accepts. This is the client's account, so treat push rights as real once accepted.
- This file updated and pushed as a second commit.

### 2026-11-03 — MCP repair, schema build

**Asked:** check the MCP connection, then build the first version of the plan in NocoDB.

- MCP was failing. Root causes: the pasted token id was `ncr4iczvd33zkdb7` but the real one is `ncd9flwpnci3ln6a`; the visible `xxxxxxxxxxxxxxxxxxxxxxxxxxx` was NocoDB's display placeholder, not a key; and the server needed `"oauth": false`. After that: `✓ nocodb-petcom connected`, 205 tools, live `listWorkspaces`/`listBases`.
- Round-trip test: created `zz_mcp_connection_test`, wrote 2 rows, read them back with a filter and a sort, got server-assigned ids and `CreatedAt`. Confirmed real writes. User deleted the table.
- Created `.gitignore` (verified in a throwaway `git init` that `.env`, `.env.local`, `.nocodb-token` are ignored and `opencode.jsonc` is tracked), `.env`, `.nocodb-token`, and the project `opencode.jsonc` with `"x-api-key": "{file:./.nocodb-token}"`.
- Built all 20 tables from §4 in three batches (independent → dependent → `tickets`/`payments`/`change_responses`/`refunds`), using `mo` links so NocoDB created the reverse fields.
- Attempted the §4 views: every `createView` hung ~60 s and failed with `KnexTimeoutError`. Isolated it — not transient (survived `docker restart`), not the pool (reads at 140 ms), not options (failed bare on a fresh probe table).
- Discovered `updateView` also fails, so default grid views cannot be converted to kanban/form.
- Found the bigger risk: `docker inspect` shows `Mounts: []` and `RestartPolicy: no` — the database exists only inside the container.

### 2026-11-04 — Views via duplication, documentation

**Asked:** create an `AGENTS.md` that logs discussions, plans, stack, decisions, tasks and things to ignore.

- Found `duplicateView` works (529 ms) while `createView` does not — so built views by duplicating the default grid and giving the copy a title.
- Confirmed `updateView` fails even with title only, so "renaming" the default view was done by duplicating it under the new name and deleting the original (NocoDB promotes the next view).
- Built 10 views (3 "All …", 4 CRM segments, check-in and no-shows, offline and paid orders). Removed a duplicate filter that `duplicateView` carried over into "No-shows", and cleared the inherited `status = valid` filter from "All tickets".
- Wrote `NOCODB_SCHEMA.md` (table ids, relations, deviations, the bug write-up, the volume warning).
- Wrote this file.
- Still open: kanban + form views (UI only), seeding a real event, the volume fix, and every question in §8.

### 2026-11-04 — Frontend & admin panel plan

**Asked:** plan the frontend, admin panel, and customer/staff interfaces; deliver it as a standalone HTML for approval before building.

- Re-read the full 630-line plan, then generated a design system for the product (caring teal + warm orange; Varela Round display + Nunito Sans UI; clay-soft on public pages, flat in admin). Contrast verified: white on teal-700 and orange-700 passes 4.5:1; teal-600/orange-500 are highlights only.
- Wrote `FRONTEND_PLAN.html` — 14 sections: the NocoDB-only vs Postgres+Next.js fork, architecture (+ SVG topology), data layer and migration path, API table, customer experience, admin panel, scanner/offline, design system, cross-cutting (auth, jobs, security, tests), repo conventions, six-sprint sequence, risks, and a 7-item approval checklist.
- Key recommendation in the doc: **Option B** — Postgres as source of truth, Next.js as the only writer, NocoDB connected to the same Postgres as the power UI. The current SQLite base becomes a design reference only.
- Validated the document: HTML tag balance clean, rendered in Playwright at 1440px and 390px, fixed a misleading webhook arrow and an overlapping bidirectional link, corrected a swatch/token mismatch.
- **Nothing built.** The doc's §14 (D1–D7) is the approval gate; the doc is also self-documenting about what stays unbuilt until then.

### Still open after the frontend-plan session

- `FRONTEND_PLAN.html` §15 not yet ticked — D1 (Postgres), D2 (hosting), D3 (design direction), D4 (magic-link auth), D5 (Payment Links), D6 (sprint order), D7 (domain + brand assets), D8 (cash approval).
- The five client questions behind the defaults: refund/transfer policy (Q6), GST (Q7), event size/frequency (Q5), who may publish (Q10), second alert recipient (Q16).

### 2026-11-04 — Counter sales and cash approval

**Asked:** add counter/venue sales with a payment-mode choice; cash sales must land in the admin portal as a pending request and generate **no ticket** until an admin approves.

- New **§09 "Counter sales & cash approval"** in `FRONTEND_PLAN.html` (doc renumbered 09–14 → 10–15, so nav, `sec-num`, ids and section comments all shifted; approval checklist is now §15).
- Core rule written into the plan: four counter modes, two behaviours. Cash and comp → order `pending` + `approval_status = pending`, seats held, tickets created `void` with **no `qr_token`**, nothing delivered. UPI/card → Razorpay webhook → `markPaid` → tickets valid immediately, same code path as public checkout.
- The loop: pick → details (phone required for cash) → mode → request → owner approves on a phone → QR tokens minted and delivered. Seller sees a waiting state, never a printable ticket; owner sees staff, customer, amount, waiting time, and Approve / Reject-with-reason / Extend-hold.
- **A1:** the seats are held while pending (default 2h, capped at event start, extendable) — otherwise the last ticket sells online while the customer stands there with cash.
- Failure cases documented: rejection after cash taken, expiry, capacity sold out while pending, double-tap approve, event cancelled with requests open, unreachable approver.
- Controls: segregation (seller ≠ approver), `audit_log` on every transition, daily per-staff cash reconciliation, amounts recomputed server-side, `owner_alerts` escalation after 5 minutes.
- Schema impact — **five columns on `orders`, no new table**: `approval_status`, `approved_by`, `approved_at`, `approval_expires_at`, `rejection_reason`.
- Propagated everywhere so the document doesn't contradict itself: §04 added-columns card, §05 `POST /api/admin/sell` rewritten + new `POST /api/admin/approvals/[id]` (no re-auth — one tap at a venue), §05 non-negotiables, §07 Approvals + Cash reconciliation + Settings cards and the "Approve a cash sale" permission row, §08 `/sell` text, §10 security checklist and a fourth invariant test ("cash cannot self-issue"), §11 `admin/approvals/` route, §13 sprint 4 acceptance, §14 new risk (approval becomes a bottleneck at the door), §15 **D8**.
- Doc bumped to **v1.1**; chip now reads "8 decisions in §15". Validated: tag balance clean, 15 sections numbered 01–15, TOC matches ids, no stray `§14` references.
- Rendered in Playwright at 1440px and 390px. Found tables cramming into unreadable columns on mobile, so every table is now wrapped in a horizontally scrollable container (`.tbl-scroll`) rather than reflowed — the wireframe `tbl-ph` mock is excluded. Fixed a punctuation glitch in the cash-loop step 4.
- **Nothing built.** The schema in NocoDB is unchanged — the five `orders` columns exist only in the plan, not in the base.

**Still open after this session:** D1–D8 in §15, still awaiting Hansh's tick. The approval policy knobs D8 nominates — hold duration, whether comps need approval, any auto-approve threshold — are set to the conservative defaults and can be loosened later.

### 2026-11-04 — v1 built: Postgres, Next.js, checkout, QR, scanner, cash approval

**Asked:** "build the first version" — the app, not another document. Scope taken as sprint 0 + sprint 1 + the §09 cash-approval loop, not all six sprints.

- **Postgres first.** `postgres:16-alpine` in Docker `petcom-pg`, port 5433, named volume `petcom_pg`, `--restart unless-stopped`. `lib/db/schema.ts` holds all 24 tables (the 20 from §4, the 5 approval columns on `orders`, plus `auth_users`, `auth_sessions`, `otp_codes`, `webhook_events`). Pushed with `drizzle-kit push`, not migrations — migrations become mandatory the moment this is deployed.
- **Domain layer before UI**, one file per concern: `inventory.ts` (holds, availability, sweeper), `payments.ts` (`markPaid`, `issueTickets`), `checkin.ts`, `counter-sales.ts` (`createCounterSale`, `approveSale`, `rejectSale`, `extendHold`), `customers.ts` (CRM upsert by phone), `audit.ts`. Each owns a transaction; nothing writes tickets from two places.
- **The four invariants are tests, not claims** — 20 passing:
  - 20 concurrent buyers for the last seat → exactly 1 order holds it (`FOR UPDATE` on the tier row);
  - 3 deliveries of the same payment → 1 paid order, 1 ticket set, 1 queued message;
  - 10 parallel scans of one token → 1 admitted, 9 `already_used`;
  - a seller approving their own cash sale → refused server-side.
  Plus hold expiry, amount mismatch, junk QR, full-URL-as-token.
- **UI built with server components + `useActionState`**, no component library: public home, event page, checkout, ticket page (server-rendered SVG QR), login, scanner, counter sale, counter order status, dashboard, approvals, orders, events. Design tokens from `FRONTEND_PLAN.html` (teal/orange, Varela Round + Nunito Sans).
- **Cash loop proven end to end in the browser:** seller takes ₹598 cash → order `pending` + `approval_status=pending`, 2 tickets `void`, `qr_token` NULL, seller's page says "no QR exists anywhere" → owner approves → QR minted, `approved_by` recorded, audit row written → scanner admits one → rescan says already scanned. Owner's own sale shows a **disabled, visibly faded** "Awaiting another owner" button and the server refuses it anyway (`sale.approved_by <> sale.sold_by` is a DB check constraint too).
- **Three real bugs found by looking, not by assuming:**
  1. Drizzle renders `${events.id}` unqualified inside a raw `sql` subquery → event stats said `tiers 1 / sold 1` for an event with 2 tiers and 3 tickets. Fixed by writing `events.id` literally (§7).
  2. `"use server"` modules cannot export `emptyXState` constants — the build failed naming a *page*, not the action file. States are inline now.
  3. A disabled approval button still looked live (no `:disabled` style) → added `.btn:disabled` with `pointer-events: none`, and the label now says why.
- **Session hardening:** the cookie is signed but not trusted — `getSession()` re-reads `staff` and takes the role from the database, so deactivating an account kills the session on the next request. Verified by setting `active = false` mid-session: `/admin` redirected to `/login` immediately.
- **Mobile pass at 390px** on `/`, `/e/[slug]`, `/sell`, `/approvals`, `/ticket/[token]`, `/scan`, `/admin`: staff nav now wraps instead of scrolling out of reach, the dashboard order table drops Event/Channel below `sm`, and the "needs approval" pill hides on small screens (it needed `!hidden` — see §7 for why).
- **Data left clean**: truncated and re-seeded — one published event (Diwali with Pets, 30 seats, ₹499/₹299), three staff, three templates, zero orders.
- **Verified before reporting**: `npx tsc --noEmit` exit 0, `npm run build` exit 0, `npx vitest run` 20/20, and a browser walkthrough of every route (finished early on 05 Nov — no page logged a console error).

**Not built, on purpose:** email/WhatsApp sending, refunds, event changes, Meta CAPI, uploads, scanner offline mode, NocoDB-on-Postgres. The tables for most of them exist and are empty.

**Still open after this session:** commit the app (nothing is tracked yet), deploy, live Razorpay test, NocoDB → Postgres, and every question in §8 except Q1.

### 2026-11-05 — "error when I run it": Postgres was stopped; found `next dev` eating this file

**Asked:** "I am getting an error when I run it, run it and verify it works."

- **Root cause of the error: the `petcom-pg` container was stopped**, not an app bug. Docker reported `Exited (137)` and the container log ended with a clean `received fast shutdown request` at 08:16 UTC. With nothing on 5433, every DB-backed page returned **500**:
  ```
  connect ECONNREFUSED ::1:5433
  Failed query: select ... from "events" where "events"."status" in ($1, $2, $3)
  ```
  Reproduced deliberately (`docker stop petcom-pg` → `GET /` → exact 500 above), then `docker start petcom-pg` → 200. No code changed.
- **Verified end to end after the restart** (Playwright, real cookies): `/` 200 with the seeded event → `/login` 200 → OTP read from the dev terminal → `/admin` as Hansh · Owner → `/e/diwali-with-pets` → hold 1 Adult-only seat (`/checkout/1`, hold 9:54, phone masked) → mock pay → `/ticket/[token]` with a rendered QR and masked PII → `/scan` admits ("Let them in", recorded against the staff member) → rescan refuses ("Already scanned") → `/admin/orders` shows `#1 · online · paid · ₹299`.
- **DB after the flow:** order `paid`, `total_paise = 29900`, ticket `valid` → `checked_in`, `qr_token` 22 chars. Then `npx vitest run` — **20/20 in 48 s** (it truncates the dev DB, which also cleared the verification order) → `npm run db:seed` → `{events 1, tiers 2, staff 3, orders 0, tickets 0}`. `npm run typecheck` exit 0.
- **Second bug, found by accident:** `AGENTS.md` had shrunk to 22,853 bytes with only §1–§7 and ended mid-sentence, `LastWriteTime` 13:51:37 — the second `npm run dev` started. Cause: `next dev` replaces from the **first literal agent-rules marker** to EOF, and §7 mentioned that marker inline in a bullet. **This file was restored in full and the inline marker removed**; a trap was added to §7 and rule 8 to §11. If you ever see this file end mid-sentence after a dev start, that is the cause.
- **Only remaining browser console error:** `GET /favicon.ico 404` — no `app/icon.*` and no `public/`. Cosmetic.
- **Hardening added (user approved both):**
  1. `scripts/dev-prepare.mjs` + `predev` in `package.json`. `npm run dev` now refuses to start when port 3000
     is already answering (the raw `EADDRINUSE` from a forgotten dev server), starts `petcom-pg` if it is
     stopped, waits up to 30 s for `pg_isready`, and exits 1 with a named cause when Docker is not running or
     the container does not exist. The port probe must *connect*, not bind — on Windows a probe bind succeeds
     anyway because of `SO_REUSEADDR`.
  2. `agentRules: false` in `next.config.ts`. `next dev` removed its managed block from this file on the next
     start and left everything else untouched. Verified after a restart: same byte count, all 14 sections.
- Still open: nothing committed (repo has zero commits), and the favicon 404.

## 13. Files

| Path | What it is |
|---|---|
| `AGENTS.md` | This file — project memory, read first |
| `FRONTEND_PLAN.html` | Frontend + admin + staff plan, standalone, for approval (8 decisions in §15) |
| `NOCODB_SCHEMA.md` | NocoDB reference: table ids, fields, relations, deviations |
| `docs/superpowers/plans/2026-11-04-petcom-v1.md` | The v1 implementation plan that was executed |
| `lib/db/schema.ts` | **Authoritative** database schema — 24 tables, constraints, FKs |
| `lib/domain/*.ts` | Business rules; each owns its transaction (`inventory`, `payments`, `checkin`, `counter-sales`, `customers`, `audit`, `tickets`, `errors`) |
| `lib/auth/*.ts` | OTP login, HMAC session cookie (+ DB re-validation), role guard |
| `lib/queries.ts` | Every read used by pages; correlated subqueries live here |
| `app/actions/*.ts` | Server actions: `checkout`, `counter`, `events` |
| `app/api/**/route.ts` | `check-in`, `payments/create-order`, `payments/verify`, `webhooks/razorpay`, `cron/expire` |
| `components/*.tsx` | Shared UI: chrome, staff shell, checkout/counter/event/login forms, scanner console, countdown, auto-refresh |
| `scripts/seed.ts` | `npm run db:seed` — demo event, 3 staff, 3 templates (idempotent) |
| `tests/*.test.ts` + `tests/global-setup.ts` | The four invariant suites; teardown truncates the database |
| `.env.local` | `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `PAYMENTS_MODE`, Razorpay keys — **gitignored** |
| `.env.example` | The same keys, no values — tracked |
| `opencode.jsonc` | Project MCP config; key referenced via `{file:./.nocodb-token}` |
| `.nocodb-token` | Bare API token, no trailing newline — **gitignored** |
| `.env` | `NOCODB_API_KEY=...` — **gitignored** |
| `.gitignore` | Env files, `.nocodb-token`, `node_modules/`, `.opencode/`, `.next/`, `next-env.d.ts`, `.playwright-mcp/`, root `/*.png` |
| `C:\Users\eddie\Desktop\PETCOM_PLATFORM_PLAN.md` | The authoritative build plan (630 lines) |

## 14. Environment facts

| | |
|---|---|
| App | `http://localhost:3000`, `npm run dev` (Next 16 dev server, Turbopack) |
| Start here | `docker start petcom-pg` → `npm run db:seed` → `npm run dev` (the `predev` guard starts the container itself and waits for `pg_isready`) |
| Health check | `docker ps --filter name=petcom-pg` must say `Up`. If it says `Exited`, every page 500s (§7) |
| Login codes | printed in the terminal running `npm run dev` (no SMTP) |
| Postgres | container `petcom-pg`, `postgres:16-alpine`, port **5433**, volume `petcom_pg`, `--restart unless-stopped` |
| DB URL | `postgres://petcom:petcom@localhost:5433/petcom` (dev only) |
| Schema push | `npm run db:push` (`drizzle-kit push --force`) — no migration files yet |
| Tests | `npx vitest run` — truncates the database it points at |
| Demo staff | `owner@petcom.in` · `seller@petcom.in` · `scanner@petcom.in` |
| NocoDB | `http://localhost:8080` |
| NocoDB container | `keen_lamport`, image `nocodb/nocodb:latest`, version `2026.10.1` |
| NocoDB storage | SQLite at `/usr/app/data/noco.db`, **no volume mount** |
| MCP endpoint | `http://localhost:8080/mcp/ncd9flwpnci3ln6a` |
| MCP auth | `x-api-key` header (also accepts `xc-mcp-token`); token title `petcom-opencode` |
| Token regeneration | Same id, new secret, old secret dies immediately; the stored value is a SHA-256 hash and cannot be recovered |
| Workspace / Base | `wwj643se` (`Default Workspace`) / `p4k50suef4oc1gn` (`Petcom`) |
