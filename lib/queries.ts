import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  customers,
  events,
  orders,
  ownerAlerts,
  staff,
  ticketTypes,
  tickets,
} from "@/lib/db/schema";

/* ------------------------------------------------------------------ *
 * Public catalogue
 * ------------------------------------------------------------------ */

const SELLABLE = ["on_sale", "sold_out", "scheduled"] as const;

export async function publicEvents() {
  return db
    .select()
    .from(events)
    .where(inArray(events.status, [...SELLABLE]))
    .orderBy(events.startsAt);
}

export async function eventBySlug(slug: string) {
  const [row] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);
  return row ?? null;
}

export async function eventById(id: number) {
  const [row] = await db.select().from(events).where(eq(events.id, id)).limit(1);
  return row ?? null;
}

export async function tiersFor(eventId: number) {
  return db
    .select()
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, eventId))
    .orderBy(ticketTypes.pricePaise, ticketTypes.id);
}

/* ------------------------------------------------------------------ *
 * Orders and tickets
 * ------------------------------------------------------------------ */

export async function orderSummary(orderId: number) {
  const [row] = await db
    .select({
      order: orders,
      eventTitle: events.title,
      eventSlug: events.slug,
      startsAt: events.startsAt,
      venueName: events.venueName,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      soldByName: staff.name,
      approvedByName: sql<string | null>`(select a.name from staff a where a.id = orders.approved_by)`,
    })
    .from(orders)
    .innerJoin(events, eq(orders.eventId, events.id))
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(staff, eq(orders.soldBy, staff.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  return row ?? null;
}

export async function ticketsForOrder(orderId: number) {
  return db
    .select()
    .from(tickets)
    .where(eq(tickets.orderId, orderId))
    .orderBy(tickets.id);
}

export async function ticketByToken(token: string) {
  const [row] = await db
    .select({
      ticket: tickets,
      order: orders,
      event: events,
      tierName: ticketTypes.name,
      holderEmail: customers.email,
    })
    .from(tickets)
    .innerJoin(orders, eq(tickets.orderId, orders.id))
    .innerJoin(events, eq(tickets.eventId, events.id))
    .innerJoin(ticketTypes, eq(tickets.ticketTypeId, ticketTypes.id))
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .where(eq(tickets.qrToken, token))
    .limit(1);
  return row ?? null;
}

export async function ticketsForEvent(eventId: number) {
  return db
    .select()
    .from(tickets)
    .where(eq(tickets.eventId, eventId))
    .orderBy(tickets.id);
}

/* ------------------------------------------------------------------ *
 * Admin reads
 * ------------------------------------------------------------------ */

export async function dashboardStats() {
  const [revenue] = await db
    .select({
      total: sql<number>`coalesce(sum(${orders.totalPaise}), 0)::int`,
      paidOrders: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(inArray(orders.status, ["paid", "partially_refunded"]));

  const [ticketCounts] = await db
    .select({
      sold: sql<number>`count(*) filter (where ${tickets.status} in ('valid','checked_in'))::int`,
      admitted: sql<number>`count(*) filter (where ${tickets.status} = 'checked_in')::int`,
    })
    .from(tickets);

  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.approvalStatus, "pending"));

  const [alerts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ownerAlerts)
    .where(isNull(ownerAlerts.readAt));

  return {
    revenuePaise: revenue?.total ?? 0,
    paidOrders: revenue?.paidOrders ?? 0,
    ticketsSold: ticketCounts?.sold ?? 0,
    admitted: ticketCounts?.admitted ?? 0,
    waitingApprovals: waiting?.n ?? 0,
    unreadAlerts: alerts?.n ?? 0,
  };
}

export async function eventsOverview() {
  // Correlated subqueries rather than joins: a join across tickets and orders
  // multiplies the rows and quietly inflates both counts and revenue.
  //
  // The outer table is named literally (`events.id`), not interpolated: drizzle
  // renders an interpolated column unqualified, which inside a subquery binds
  // to the *inner* table's `id` and counts nonsense.
  return db
    .select({
      event: events,
      tiers: sql<number>`(select count(*)::int from ticket_types tt where tt.event_id = events.id)`,
      sold: sql<number>`(
        select count(*)::int from tickets t
        where t.event_id = events.id and t.status in ('valid','checked_in')
      )`,
      revenue: sql<number>`(
        select coalesce(sum(o.total_paise), 0)::int from orders o
        where o.event_id = events.id and o.status in ('paid','partially_refunded')
      )`,
    })
    .from(events)
    .orderBy(desc(events.startsAt));
}

export async function recentOrders(limit = 50) {
  return db
    .select({
      id: orders.id,
      status: orders.status,
      channel: orders.channel,
      totalPaise: orders.totalPaise,
      approvalStatus: orders.approvalStatus,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      eventTitle: events.title,
      eventId: events.id,
      soldByName: staff.name,
      ticketCount: sql<number>`(select count(*)::int from tickets t where t.order_id = orders.id)`,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(events, eq(orders.eventId, events.id))
    .leftJoin(staff, eq(orders.soldBy, staff.id))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
}

export async function unreadAlerts(limit = 8) {
  return db
    .select()
    .from(ownerAlerts)
    .where(isNull(ownerAlerts.readAt))
    .orderBy(desc(ownerAlerts.createdAt))
    .limit(limit);
}

export async function latestScans(limit = 8) {
  return db
    .select({
      id: tickets.id,
      holderName: tickets.holderName,
      checkedInAt: tickets.checkedInAt,
      device: tickets.checkInDevice,
      eventTitle: events.title,
    })
    .from(tickets)
    .innerJoin(events, eq(tickets.eventId, events.id))
    .where(eq(tickets.status, "checked_in"))
    .orderBy(desc(tickets.checkedInAt))
    .limit(limit);
}

export async function staffSummary() {
  return db
    .select({
      id: staff.id,
      name: staff.name,
      role: staff.role,
      active: staff.active,
    })
    .from(staff)
    .orderBy(staff.name);
}

export async function countTicketsForOrder(orderId: number) {
  const [row] = await db
    .select({ n: count() })
    .from(tickets)
    .where(eq(tickets.orderId, orderId));
  return row?.n ?? 0;
}

/** Cash taken today, per seller — the reconciliation the plan asks for. */
export async function cashToday() {
  return db
    .select({
      staffName: staff.name,
      channel: orders.channel,
      orders: sql<number>`count(*)::int`,
      totalPaise: sql<number>`coalesce(sum(${orders.totalPaise}), 0)::int`,
    })
    .from(orders)
    .leftJoin(staff, eq(orders.soldBy, staff.id))
    .where(
      and(
        inArray(orders.channel, ["offline_cash", "offline_upi", "offline_card", "comp"]),
        inArray(orders.status, ["paid"]),
      ),
    )
    .groupBy(staff.name, orders.channel);
}
