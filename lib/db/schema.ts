import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Shared column helpers
 * ------------------------------------------------------------------ */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

const money = (name: string) => integer(name).notNull().default(0);

/* ------------------------------------------------------------------ *
 * Core: events, ticket types
 * ------------------------------------------------------------------ */

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    venueName: text("venue_name").notNull().default(""),
    venueMapUrl: text("venue_map_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    capacity: integer("capacity").notNull().default(0),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    heroImageUrl: text("hero_image_url"),
    pixelEnabled: boolean("pixel_enabled").notNull().default(false),
    customFields: jsonb("custom_fields").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    saleStartsAt: timestamp("sale_starts_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("events_slug_uq").on(t.slug),
    check(
      "events_status_ck",
      sql`${t.status} in ('draft','scheduled','on_sale','sold_out','closed','postponed','cancelled','completed')`,
    ),
    check("events_capacity_ck", sql`${t.capacity} >= 0`),
  ],
);

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pricePaise: money("price_paise"),
    quantity: integer("quantity").notNull().default(0),
    perOrderLimit: integer("per_order_limit").notNull().default(10),
    saleStartsAt: timestamp("sale_starts_at", { withTimezone: true }),
    saleEndsAt: timestamp("sale_ends_at", { withTimezone: true }),
    includesPet: boolean("includes_pet").notNull().default(false),
    createdAt,
  },
  (t) => [
    index("ticket_types_event_idx").on(t.eventId),
    check("ticket_types_price_ck", sql`${t.pricePaise} >= 0`),
    check("ticket_types_qty_ck", sql`${t.quantity} >= 0`),
  ],
);

/* ------------------------------------------------------------------ *
 * Customers (CRM hub)
 * ------------------------------------------------------------------ */

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().default(""),
    phone: text("phone").notNull(),
    email: text("email"),
    source: text("source"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    fbclid: text("fbclid"),
    stage: text("stage").notNull().default("lead"),
    consentTransactional: boolean("consent_transactional").notNull().default(true),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    tags: text("tags"),
    notes: text("notes"),
    lifetimeValuePaise: money("lifetime_value_paise"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("customers_phone_uq").on(t.phone),
    check(
      "customers_stage_ck",
      sql`${t.stage} in ('lead','contacted','purchased','repeat','lost')`,
    ),
  ],
);

/* ------------------------------------------------------------------ *
 * Orders, tickets, payments
 * ------------------------------------------------------------------ */

export const orders = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id),
    channel: text("channel").notNull().default("online"),
    status: text("status").notNull().default("pending"),
    totalPaise: money("total_paise"),
    razorpayOrderId: text("razorpay_order_id"),
    idempotencyKey: text("idempotency_key"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    soldBy: integer("sold_by").references(() => staff.id),
    utmSnapshot: jsonb("utm_snapshot").$type<Record<string, string>>(),
    eventIdForPixel: text("event_id_for_pixel"),
    // Cash / comp approval — plan §09
    approvalStatus: text("approval_status").notNull().default("not_required"),
    approvedBy: integer("approved_by").references(() => staff.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("orders_razorpay_order_uq").on(t.razorpayOrderId),
    uniqueIndex("orders_idempotency_uq").on(t.idempotencyKey),
    index("orders_event_idx").on(t.eventId),
    index("orders_status_idx").on(t.status),
    index("orders_approval_idx").on(t.approvalStatus),
    check(
      "orders_status_ck",
      sql`${t.status} in ('pending','paid','failed','expired','refunded','partially_refunded','cancelled')`,
    ),
    check(
      "orders_channel_ck",
      sql`${t.channel} in ('online','offline_cash','offline_upi','offline_card','comp')`,
    ),
    check(
      "orders_approval_ck",
      sql`${t.approvalStatus} in ('not_required','pending','approved','rejected','expired')`,
    ),
    check("orders_total_ck", sql`${t.totalPaise} >= 0`),
  ],
);

export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: integer("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    holderName: text("holder_name").notNull().default(""),
    holderPhone: text("holder_phone"),
    petName: text("pet_name"),
    petBreed: text("pet_breed"),
    qrToken: text("qr_token"),
    status: text("status").notNull().default("void"),
    acknowledgedVersion: integer("acknowledged_version").notNull().default(0),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInBy: integer("checked_in_by").references(() => staff.id),
    checkInDevice: text("check_in_device"),
    createdAt,
  },
  (t) => [
    uniqueIndex("tickets_qr_token_uq").on(t.qrToken),
    index("tickets_order_idx").on(t.orderId),
    index("tickets_event_idx").on(t.eventId),
    index("tickets_status_idx").on(t.status),
    check(
      "tickets_status_ck",
      sql`${t.status} in ('valid','checked_in','void','cancelled','refund_requested')`,
    ),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    razorpayPaymentId: text("razorpay_payment_id"),
    amountPaise: money("amount_paise"),
    method: text("method"),
    status: text("status").notNull().default("created"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    rawWebhook: jsonb("raw_webhook"),
    createdAt,
  },
  (t) => [
    uniqueIndex("payments_provider_id_uq").on(t.razorpayPaymentId),
    index("payments_order_idx").on(t.orderId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    paymentId: integer("payment_id")
      .notNull()
      .references(() => payments.id),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    ticketId: integer("ticket_id").references(() => tickets.id),
    amountPaise: money("amount_paise"),
    reason: text("reason").notNull().default("manual"),
    status: text("status").notNull().default("queued"),
    razorpayRefundId: text("razorpay_refund_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    initiatedBy: integer("initiated_by").references(() => staff.id),
    initiatedAt: timestamp("initiated_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
    manualReference: text("manual_reference"),
  },
  (t) => [
    uniqueIndex("refunds_idempotency_uq").on(t.idempotencyKey),
    index("refunds_order_idx").on(t.orderId),
  ],
);

/* ------------------------------------------------------------------ *
 * Staff, sessions, auth
 * ------------------------------------------------------------------ */

export const staff = pgTable(
  "staff",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: text("role").notNull().default("sales"),
    pinHash: text("pin_hash"),
    active: boolean("active").notNull().default(true),
    createdAt,
  },
  (t) => [
    uniqueIndex("staff_email_uq").on(t.email),
    check("staff_role_ck", sql`${t.role} in ('owner','sales','scanner')`),
  ],
);

export const authUsers = pgTable(
  "auth_users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    staffId: integer("staff_id").references(() => staff.id),
    createdAt,
  },
  (t) => [uniqueIndex("auth_users_email_uq").on(t.email)],
);

export const authSessions = pgTable("auth_sessions", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id")
    .notNull()
    .references(() => staff.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
});

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    code: text("code").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("otp_email_idx").on(t.email)],
);

/* ------------------------------------------------------------------ *
 * Messaging + automation queue
 * ------------------------------------------------------------------ */

export const messageTemplates = pgTable(
  "message_templates",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    channel: text("channel").notNull().default("email"),
    subject: text("subject"),
    body: text("body").notNull().default(""),
    providerTemplateId: text("provider_template_id"),
    approved: boolean("approved").notNull().default(false),
    createdAt,
  },
  (t) => [uniqueIndex("message_templates_key_channel_uq").on(t.key, t.channel)],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").references(() => customers.id),
    ticketId: integer("ticket_id").references(() => tickets.id),
    channel: text("channel").notNull().default("email"),
    template: text("template").notNull(),
    status: text("status").notNull().default("queued"),
    providerId: text("provider_id"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index("messages_ticket_idx").on(t.ticketId),
    check("messages_status_ck", sql`${t.status} in ('queued','sent','delivered','failed')`),
  ],
);

export const eventAutomations = pgTable(
  "event_automations",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    offsetMinutes: integer("offset_minutes").notNull().default(0),
    channels: text("channels").notNull().default("email"),
    templateId: integer("template_id").references(() => messageTemplates.id),
    segmentFilter: jsonb("segment_filter"),
  },
  (t) => [uniqueIndex("event_automations_key_uq").on(t.eventId, t.key)],
);

export const scheduledJobs = pgTable(
  "scheduled_jobs",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").references(() => events.id, { onDelete: "cascade" }),
    automationKey: text("automation_key").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt,
  },
  (t) => [
    index("scheduled_jobs_run_idx").on(t.status, t.runAt),
    check(
      "scheduled_jobs_status_ck",
      sql`${t.status} in ('pending','running','done','failed','cancelled')`,
    ),
  ],
);

/* ------------------------------------------------------------------ *
 * Events: media, changes, alerts
 * ------------------------------------------------------------------ */

export const eventTemplates = pgTable("event_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  defaultTicketTypes: jsonb("default_ticket_types"),
  defaultCustomFields: jsonb("default_custom_fields"),
  defaultAutomations: jsonb("default_automations"),
  createdAt,
});

export const assets = pgTable(
  "assets",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").references(() => events.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    kind: text("kind").notNull().default("hero"),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    uploadedBy: integer("uploaded_by").references(() => staff.id),
    createdAt,
  },
  (t) => [index("assets_event_idx").on(t.eventId)],
);

export const eventChanges = pgTable(
  "event_changes",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    changeType: text("change_type").notNull(),
    oldValues: jsonb("old_values"),
    newValues: jsonb("new_values"),
    reason: text("reason"),
    changedBy: integer("changed_by").references(() => staff.id),
    notifySentAt: timestamp("notify_sent_at", { withTimezone: true }),
    responseDeadline: timestamp("response_deadline", { withTimezone: true }),
    refundWindowEndsAt: timestamp("refund_window_ends_at", { withTimezone: true }),
    defaultIfNoResponse: text("default_if_no_response").notNull().default("keep"),
    createdAt,
  },
  (t) => [
    index("event_changes_event_idx").on(t.eventId),
    check(
      "event_changes_type_ck",
      sql`${t.changeType} in ('reschedule','venue_change','postponed','cancelled')`,
    ),
  ],
);

export const changeResponses = pgTable(
  "change_responses",
  {
    id: serial("id").primaryKey(),
    changeId: integer("change_id")
      .notNull()
      .references(() => eventChanges.id, { onDelete: "cascade" }),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    response: text("response").notNull().default("no_response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    channel: text("channel"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    remindersSent: integer("reminders_sent").notNull().default(0),
  },
  (t) => [uniqueIndex("change_responses_uq").on(t.changeId, t.ticketId)],
);

export const ownerAlerts = pgTable(
  "owner_alerts",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    severity: text("severity").notNull().default("info"),
    eventId: integer("event_id").references(() => events.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body"),
    channelsSent: text("channels_sent"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt,
  },
  (t) => [index("owner_alerts_read_idx").on(t.readAt)],
);

/* ------------------------------------------------------------------ *
 * Tracking, CRM timeline, audit
 * ------------------------------------------------------------------ */

export const trackingEvents = pgTable(
  "tracking_events",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").references(() => customers.id, { onDelete: "set null" }),
    anonymousId: text("anonymous_id"),
    eventName: text("event_name").notNull(),
    eventId: text("event_id"),
    eventSourceUrl: text("event_source_url"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    fbp: text("fbp"),
    fbc: text("fbc"),
    sentToCapiAt: timestamp("sent_to_capi_at", { withTimezone: true }),
    capiStatus: text("capi_status"),
    createdAt,
  },
  (t) => [index("tracking_events_dedup_idx").on(t.eventName, t.eventId)],
);

export const customerActivity = pgTable(
  "customer_activity",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    eventId: integer("event_id").references(() => events.id, { onDelete: "set null" }),
    meta: jsonb("meta"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customer_activity_customer_idx").on(t.customerId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    staffId: integer("staff_id").references(() => staff.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

/* ------------------------------------------------------------------ *
 * Webhook dedup
 * ------------------------------------------------------------------ */

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: serial("id").primaryKey(),
    provider: text("provider").notNull().default("razorpay"),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt,
  },
  (t) => [uniqueIndex("webhook_events_provider_uq").on(t.provider, t.providerEventId)],
);

/* ------------------------------------------------------------------ *
 * Relations (for query convenience; joins are explicit in domain code)
 * ------------------------------------------------------------------ */

export const eventsRelations = relations(events, ({ many }) => ({
  ticketTypes: many(ticketTypes),
  orders: many(orders),
}));

export const ticketTypesRelations = relations(ticketTypes, ({ one, many }) => ({
  event: one(events, { fields: [ticketTypes.eventId], references: [events.id] }),
  tickets: many(tickets),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  event: one(events, { fields: [orders.eventId], references: [events.id] }),
  tickets: many(tickets),
  payments: many(payments),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  order: one(orders, { fields: [tickets.orderId], references: [orders.id] }),
  event: one(events, { fields: [tickets.eventId], references: [events.id] }),
  ticketType: one(ticketTypes, { fields: [tickets.ticketTypeId], references: [ticketTypes.id] }),
}));
