import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { customers, events, messages, orders, ownerAlerts, staff, tickets } from "@/lib/db/schema";
import { writeAudit } from "@/lib/domain/audit";
import { recordPurchase } from "@/lib/domain/customers";
import { DomainError } from "@/lib/domain/errors";
import { createHold, HOLDS } from "@/lib/domain/inventory";
import { issueTickets, markPaid } from "@/lib/domain/payments";

export type CounterMode = "cash" | "upi" | "card" | "comp";

export type CounterSaleInput = {
  staffId: number;
  eventId: number;
  ticketTypeId: number;
  quantity: number;
  mode: CounterMode;
  holderName: string;
  holderPhone: string;
  now?: Date;
};

export type CounterSaleResult =
  | {
      kind: "issued";
      orderId: number;
      ticketTokens: string[];
      totalPaise: number;
    }
  | {
      kind: "awaiting_approval";
      orderId: number;
      totalPaise: number;
      expiresAt: Date;
    };

/**
 * A counter sale. Two very different things happen depending on the mode:
 *
 * - UPI / card: the gateway is the source of truth. We take the money through
 *   the same `markPaid` path as the public checkout, so tickets issue at once.
 * - cash / comp: a person — not a gateway — is claiming money changed hands.
 *   That is a request, not a sale: the order waits, and no QR token exists
 *   until an approver who is not the seller confirms it.
 */
export async function createCounterSale(input: CounterSaleInput): Promise<CounterSaleResult> {
  const now = input.now ?? new Date();

  if (input.mode === "cash" || input.mode === "comp") {
    const [event] = await db
      .select({ startsAt: events.startsAt })
      .from(events)
      .where(eq(events.id, input.eventId))
      .limit(1);

    if (!event) throw new DomainError("not_found", "That event does not exist.");

    // The hold never outlives the event it is holding a seat for.
    const untilEvent = Math.floor((event.startsAt.getTime() - now.getTime()) / 60_000);
    const holdMinutes = Math.max(5, Math.min(HOLDS.cashApprovalMinutes, untilEvent));

    const hold = await createHold({
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      quantity: input.quantity,
      customer: { name: input.holderName, phone: input.holderPhone },
      holdMinutes,
      channel: input.mode === "cash" ? "offline_cash" : "comp",
      soldBy: input.staffId,
      approval: true,
      now,
    });

    return {
      kind: "awaiting_approval",
      orderId: hold.orderId,
      totalPaise: hold.totalPaise,
      expiresAt: hold.expiresAt,
    };
  }

  const hold = await createHold({
    eventId: input.eventId,
    ticketTypeId: input.ticketTypeId,
    quantity: input.quantity,
    customer: { name: input.holderName, phone: input.holderPhone },
    holdMinutes: HOLDS.onlineMinutes,
    channel: input.mode === "upi" ? "offline_upi" : "offline_card",
    soldBy: input.staffId,
    now,
  });

  const paid = await markPaid(hold.orderId, {
    // In mock mode this stands in for the gateway's payment id. With live keys
    // the webhook calls markPaid with the real one; both land in the same place.
    providerPaymentId: `pay_counter_${hold.orderId}_${now.getTime().toString(36)}`,
    amountPaise: hold.totalPaise,
    method: input.mode,
  });

  return {
    kind: "issued",
    orderId: hold.orderId,
    ticketTokens: paid.ticketTokens,
    totalPaise: hold.totalPaise,
  };
}

export type Approver = { staffId: number; role: string };

/**
 * The approval that turns cash into a ticket.
 *
 * Three things are enforced here, not in the UI:
 *  1. the order is still pending and its hold has not lapsed;
 *  2. the approver is not the person who took the money;
 *  3. calling it twice issues one set of tickets, not two.
 */
export async function approveSale(orderId: number, approver: Approver) {
  if (approver.role !== "owner") {
    throw new DomainError("forbidden", "Only the owner can approve a cash sale.");
  }

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");

    if (!order) throw new DomainError("not_found", "Order not found.");

    if (order.approvalStatus === "approved" || order.status === "paid") {
      const existing = await tx
        .select({ token: tickets.qrToken })
        .from(tickets)
        .where(eq(tickets.orderId, orderId));
      return {
        ok: true as const,
        alreadyApproved: true,
        ticketTokens: existing.map((t) => t.token).filter((t): t is string => Boolean(t)),
      };
    }

    if (order.approvalStatus !== "pending") {
      throw new DomainError("invalid_state", "This request is no longer open.");
    }

    if (order.approvalExpiresAt && order.approvalExpiresAt.getTime() < Date.now()) {
      await tx
        .update(orders)
        .set({ status: "expired", approvalStatus: "expired", updatedAt: new Date() })
        .where(eq(orders.id, orderId));
      throw new DomainError("expired", "The hold expired before approval — the seats were released.");
    }

    if (order.soldBy !== null && order.soldBy === approver.staffId) {
      throw new DomainError("forbidden", "You cannot approve a sale you took yourself.");
    }

    const now = new Date();
    if (order.soldBy !== null) {
      // Segregation of duties is the whole point — record both identities.
      await writeAudit(tx, {
        staffId: approver.staffId,
        action: "cash_sale.approved",
        entity: "orders",
        entityId: orderId,
        before: { approvalStatus: order.approvalStatus, status: order.status },
        after: { approvalStatus: "approved", status: "paid" },
      });
    }

    await tx
      .update(orders)
      .set({
        status: "paid",
        approvalStatus: "approved",
        approvedBy: approver.staffId,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(orders.id, orderId));

    const issued = await issueTickets(tx, orderId);

    // Delivery is queued exactly like an online sale — one code path.
    if (issued.length > 0) {
      await tx.insert(messages).values(
        issued.map((t) => ({
          customerId: order.customerId,
          ticketId: t.id,
          channel: "email",
          template: "ticket_email",
          status: "queued",
        })),
      );
    }

    await recordPurchase(tx, order.customerId, order.totalPaise, order.eventId);

    return {
      ok: true as const,
      alreadyApproved: false,
      ticketTokens: issued.map((t) => t.token),
    };
  });
}

export async function rejectSale(orderId: number, approver: Approver, reason: string) {
  if (approver.role !== "owner") {
    throw new DomainError("forbidden", "Only the owner can reject a cash sale.");
  }
  if (!reason.trim()) throw new DomainError("invalid_state", "A reason is required.");

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new DomainError("not_found", "Order not found.");
    if (order.approvalStatus !== "pending") {
      throw new DomainError("invalid_state", "This request is no longer open.");
    }

    await tx
      .update(orders)
      .set({
        status: "cancelled",
        approvalStatus: "rejected",
        rejectionReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    // The seats come back the moment the order stops being pending.
    await writeAudit(tx, {
      staffId: approver.staffId,
      action: "cash_sale.rejected",
      entity: "orders",
      entityId: orderId,
      before: { approvalStatus: "pending" },
      after: { approvalStatus: "rejected", reason: reason.trim() },
    });

    return { ok: true as const };
  });
}

export async function extendHold(orderId: number, approver: Approver, minutes = 60) {
  if (approver.role !== "owner") {
    throw new DomainError("forbidden", "Only the owner can extend a hold.");
  }

  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!order) throw new DomainError("not_found", "Order not found.");
    if (order.approvalStatus !== "pending") {
      throw new DomainError("invalid_state", "This request is no longer open.");
    }

    const base = order.approvalExpiresAt ?? new Date();
    const next = new Date(Math.max(base.getTime(), Date.now()) + minutes * 60_000);

    await tx
      .update(orders)
      .set({ approvalExpiresAt: next, expiresAt: next, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await tx.insert(ownerAlerts).values({
      type: "cash_hold_extended",
      severity: "info",
      eventId: order.eventId,
      title: `Hold extended on order #${order.id}`,
      body: `Now expires ${next.toISOString()}.`,
    });

    return { ok: true as const, expiresAt: next };
  });
}

/**
 * Releases seats for requests nobody answered. Run from cron.
 * The customer is told at the counter; the owner gets an alert so the gap is
 * never silent.
 */
export async function expirePendingApprovals(now = new Date()) {
  const stale = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.approvalStatus, "pending"),
        isNotNull(orders.approvalExpiresAt),
        lt(orders.approvalExpiresAt, now),
      ),
    );

  for (const order of stale) {
    await db
      .update(orders)
      .set({ status: "expired", approvalStatus: "expired", updatedAt: now })
      .where(eq(orders.id, order.id));

    await db.insert(ownerAlerts).values({
      type: "cash_approval_expired",
      severity: "warn",
      eventId: order.eventId,
      title: `Cash request expired · order #${order.id}`,
      body: `Nobody approved ₹${(order.totalPaise / 100).toFixed(0)} in time. The seats were released.`,
    });
  }

  return { expired: stale.length };
}

export async function pendingApprovals() {
  return db
    .select({
      order: orders,
      eventTitle: events.title,
      customerName: customers.name,
      customerPhone: customers.phone,
      soldByName: staff.name,
      expiresAt: orders.approvalExpiresAt,
      ticketCount: sql<number>`(select count(*)::int from tickets t where t.order_id = orders.id)`,
    })
    .from(orders)
    .innerJoin(events, eq(orders.eventId, events.id))
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(staff, eq(orders.soldBy, staff.id))
    .where(eq(orders.approvalStatus, "pending"))
    .orderBy(orders.createdAt);
}

export function cashShiftSummaryQuery() {
  return sql`
    select s.name as staff_name,
           count(*) filter (where o.channel = 'offline_cash') as cash_requests,
           coalesce(sum(o.total_paise) filter (where o.status = 'paid' and o.channel = 'offline_cash'), 0) as cash_approved_paise,
           coalesce(sum(o.total_paise) filter (where o.approval_status = 'rejected'), 0) as rejected_paise
    from orders o
    join staff s on s.id = o.sold_by
    group by s.name
  `;
}

export type { Tx };
