import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events, staff, ticketTypes } from "@/lib/db/schema";

export async function resetDb() {
  await db.execute(sql`
    truncate table
      change_responses, event_changes, owner_alerts, scheduled_jobs, event_automations,
      messages, message_templates, audit_log, tracking_events, customer_activity,
      refunds, payments, tickets, orders, customers, ticket_types, assets, events,
      otp_codes, auth_sessions, auth_users, staff, webhook_events, event_templates
    restart identity cascade
  `);
}

export async function seedEvent(options?: {
  capacity?: number;
  tierQuantity?: number;
  pricePaise?: number;
  startsAt?: Date;
}) {
  const capacity = options?.capacity ?? 100;
  const quantity = options?.tierQuantity ?? capacity;
  const pricePaise = options?.pricePaise ?? 59900;

  const [event] = await db
    .insert(events)
    .values({
      slug: "test-event",
      title: "Test Event",
      description: "A test event",
      venueName: "Test Venue",
      startsAt: options?.startsAt ?? new Date(Date.now() + 7 * 864e5),
      capacity,
      status: "on_sale",
    })
    .returning();

  const [tier] = await db
    .insert(ticketTypes)
    .values({
      eventId: event.id,
      name: "General",
      pricePaise,
      quantity,
      perOrderLimit: 10,
    })
    .returning();

  return { event, tier };
}

export async function seedStaff() {
  const [owner] = await db
    .insert(staff)
    .values({ name: "Owner", email: "owner@petcom.test", role: "owner" })
    .returning();
  const [seller] = await db
    .insert(staff)
    .values({ name: "Seller", email: "seller@petcom.test", role: "sales" })
    .returning();
  return { owner, seller };
}

export function buyer(phone: string, name = "Asha") {
  return { name, phone, email: `${phone}@example.test` };
}
