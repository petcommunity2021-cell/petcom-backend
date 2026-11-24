# Petcom — NocoDB build log (Phase 0)

Built from `PETCOM_PLATFORM_PLAN.md` §4 (data model) + §13 Phase 0 (schema first).
Everything below was created through the NocoDB MCP connection, not the UI.

| | |
|---|---|
| NocoDB | `http://localhost:8080` — Docker container `keen_lamport`, image `nocodb/nocodb:latest`, version `2026.10.1` |
| Workspace | `Default Workspace` (`wwj643se`) |
| Base | `Petcom` (`p4k50suef4oc1gn`) |
| MCP endpoint | `http://localhost:8080/mcp/ncd9flwpnci3ln6a` |
| Auth | `x-api-key` header, token title `petcom-opencode`, read from `.nocodb-token` |
| Built | 2026-11-03 |

Open the base: http://localhost:8080/wwj643se/p4k50suef4oc1gn

---

## 1. Tables (20)

All rows are empty. Field counts include reverse link fields that NocoDB adds automatically.

| Table | ID | Fields | Purpose |
|---|---|---|---|
| `events` | `m5zkofng4lyjyoi` | 27 | One row per event; drives page, checkout, scanner, automations |
| `ticket_types` | `mbq3mkynvk4vf3o` | 12 | Price tiers per event |
| `orders` | `m9fmtvw226gx5tu` | 16 | Purchase attempt; holds inventory until paid/expired |
| `tickets` | `ma42nfhcsbjb6hx` | 18 | One row per attendee; QR check-in is one atomic update here |
| `payments` | `mxo0jtn9o0tsm8g` | 11 | Razorpay payments + raw webhook |
| `refunds` | `m6rnysm9lz7r9hs` | 16 | Refund queue; idempotency key blocks double refunds |
| `customers` | `mrrf3z6wuf5jg2j` | 23 | Leads/contacts, keyed by phone |
| `customer_activity` | `mwzb0f3yfc7rj3d` | 8 | Per-customer timeline |
| `staff` | `m9c7bw2oindx7oy` | 15 | Owner / sales / scanner accounts |
| `message_templates` | `mfqbtjn5muk3u9i` | 10 | Message bodies + provider template id |
| `messages` | `m3uibfkt6lbkfri` | 10 | Every send attempt and its status |
| `event_automations` | `mk4rtwydi9m1pci` | 10 | Which notifications fire per event |
| `scheduled_jobs` | `mspozjwtdxzwqry` | 10 | Automation queue drained by a worker |
| `event_templates` | `mkw4ixqd1nhymxr` | 7 | Starting points for event creation |
| `assets` | `mjqb9lztc47pam2` | 10 | Uploaded images per event |
| `event_changes` | `mk4zgp1hqj8bbvp` | 15 | Reschedule / venue / postpone / cancel, versioned |
| `change_responses` | `ms9e9cuyaj1yf7r` | 11 | Consent + acknowledgement per ticket per change |
| `owner_alerts` | `m1vibd7zqrxrxfe` | 10 | Alerts the owner must see |
| `tracking_events` | `mzehdqp2f3vb2y9` | 15 | Pixel/CAPI log with dedup ids |
| `audit_log` | `mfhxq4x8l80earo` | 10 | Who changed what, when |

## 2. Relationships

Every relation is many-to-one from the child table, so NocoDB created the reverse field automatically.

- `ticket_types.event_id` → events
- `orders.customer_id` → customers, `orders.event_id` → events, `orders.sold_by` → staff
- `tickets.order_id` → orders, `tickets.event_id` → events, `tickets.ticket_type_id` → ticket_types, `tickets.checked_in_by` → staff
- `payments.order_id` → orders
- `refunds.payment_id` → payments, `refunds.order_id` → orders, `refunds.ticket_id` → tickets, `refunds.initiated_by` → staff
- `change_responses.change_id` → event_changes, `change_responses.ticket_id` → tickets
- `event_changes.event_id` → events, `event_changes.changed_by` → staff
- `event_automations.event_id` → events, `event_automations.template_id` → message_templates
- `scheduled_jobs.event_id` → events
- `owner_alerts.event_id` → events
- `customer_activity.customer_id` → customers, `customer_activity.event_id` → events
- `tracking_events.customer_id` → customers
- `messages.customer_id` → customers
- `assets.event_id` → events, `assets.uploaded_by` → staff
- `audit_log.staff_id` → staff

So `customers` now carries reverse links to orders, tickets, messages, activity and tracking events — the CRM record is the hub.

## 3. Views

Built on the existing grid views (see the blocker in §6). Working views:

| Table | View | Config |
|---|---|---|
| customers | **All customers** | no filter — full list |
| customers | **Sales by source** | sorted by `utm_source` |
| customers | **Repeat attendees** | filter `stage = repeat`, sorted by `name` |
| customers | **Marketing consented** | filter `consent_marketing` is checked |
| tickets | **All tickets** | no filter |
| tickets | **Today's check-in list** | filter `status = valid`, sorted by `holder_name` |
| tickets | **No-shows** | filter `status = valid` (sold, never scanned) |
| orders | **All orders** | no filter |
| orders | **Offline sales** | filter `sold_by` is not empty (offline sales always record staff) |
| orders | **Paid orders** | filter `status = paid` |

Not built — blocked by the platform bug in §6:

- **Leads pipeline** as a *kanban* stacked by `stage`. Recreate in the UI: `customers` → view sidebar `+` → Kanban → stack by `stage`.
- **Sell offline** as a *form*. Recreate in the UI: `orders` → view sidebar `+` → Form.

## 4. Deviations from the plan

1. **Auto-increment integer `Id`** instead of the plan's `uuid`. NocoDB owns the primary key; external ids (`qr_token`, `razorpay_order_id`, `idempotency_key`) are still unique-constrained text columns, which is where idempotency actually matters.
2. **`created_at` / `updated_at` are NocoDB system fields** (`CreatedAt`, `UpdatedAt`), not authored columns.
3. **Added fields the plan mentions in later sections but omits from §4:** `events.sale_starts_at`, `events.published_at`, `ticket_types.per_order_limit`, `orders.channel` value `partially_refunded` in `status`.
4. **`customers.tags` and `customer_activity.type` are free text**, not selects — the plan generates dynamic values like `cancelled-<event>` that a fixed choice list would reject.
5. **`orders.event_id_for_pixel`** kept as text, not a link — it holds the Meta event id used for dedup, not a Petcom event.

## 5. Secrets / config

- `opencode.jsonc` in this folder registers the MCP server; the key is `{file:./.nocodb-token}` so no secret is in a tracked file.
- `.nocodb-token` holds the bare token (no trailing newline), `.env` holds it as `NOCODB_API_KEY` for humans and scripts.
- `.gitignore` excludes `.env`, `.env.*`, `.nocodb-token`, `node_modules/`, `.opencode/`.
- Rotating the token in NocoDB keeps the same token id (`ncd9flwpnci3ln6a`); only the secret changes, and the old one stops working. Update both files when rotating.

## 6. Known issues

**`createView` and `updateView` are broken in this build (`2026.10.1`).** Every call blocks ~60 s and fails:

```
Error: Failed to create View
KnexTimeoutError: Timeout acquiring a connection. The pool is probably full.
```

- Not transient: reproduced after `docker restart`, on many tables, with and without `options`, and on a fresh one-field probe table.
- Not the connection: reads answer in ~140 ms and `createTable`, `createRecords`, `createFilter`, `addSort`, `duplicateView`, `deleteView` all succeed.
- Consequence: new views can only be produced by duplicating an existing grid view (which copies its filters/sorts), and view *type* cannot be changed — so no kanban and no form view through the API. Both are one click in the UI.

**The container has no volume mount.** `docker inspect keen_lamport` reports `Mounts: []` and `RestartPolicy: no`, so the SQLite database (`/usr/app/data/noco.db`) lives in the container's writable layer. Removing or recreating the container **destroys this entire base**. Before doing anything to the container:

```
docker commit keen_lamport petcom-nocodb:backup
```

Better: recreate it with `-v petcom_nocodb:/usr/app/data --restart unless-stopped` and import from a CSV/Excel export of every table.

## 7. Next steps

Phase 0 is done: schema + the views the platform allows. Then, per the plan:

1. Seed one real event end to end (`events` → `ticket_types` → `orders` → `tickets` → `payments`) so the schema is proven against real data, not just structurally.
2. Create the kanban and form views in the UI (two clicks, §3).
3. Decide the access model: NocoDB users/roles vs. the plan's own public pages. The plan assumes public checkout + scanner, which NocoDB alone cannot serve — that needs the API layer in §13.
