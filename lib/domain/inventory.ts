import { and, eq, gt, isNotNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { events, orders, ownerAlerts, ticketTypes, tickets } from "@/lib/db/schema";
import { DomainError } from "@/lib/domain/errors";
import { upsertCustomer, type CustomerInput } from "@/lib/domain/customers";

export const HOLDS = {
  /** Online checkout: 10 minutes to complete payment. */
  onlineMinutes: 10,
  /** Counter cash request: long enough for the owner to look, short enough to free seats. */
  cashApprovalMinutes: 120,
} as const;

export type HoldInput = {
  eventId: number;
  ticketTypeId: number;
  quantity: number;
  customer: CustomerInput;
  holdMinutes?: number;
  idempotencyKey?: string | null;
  channel?: "online" | "offline_cash" | "offline_upi" | "offline_card" | "comp";
  soldBy?: number | null;
  approval?: boolean;
  now?: Date;
};

export type HoldResult = {
  orderId: number;
  customerId: number;
  totalPaise: number;
  expiresAt: Date;
  reused: boolean;
};

/** Tickets that still occupy a seat: paid, or held by an unexpired pending order. */
function occupiesSeat(now: Date) {
  return or(
    eq(orders.status, "paid"),
    and(eq(orders.status, "pending"), gt(orders.expiresAt, now)),
  );
}

async function seatsTaken(tx: Tx, where: SQL<unknown>, now: Date): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(tickets)
    .innerJoin(orders, eq(tickets.orderId, orders.id))
    .where(and(where, occupiesSeat(now)));
  return row?.count ?? 0;
}

/**
 * Reserve seats and create the order + placeholder tickets.
 *
 * The whole thing runs in one transaction with the event and ticket-type rows
 * locked `FOR UPDATE`, so two buyers pressing pay on the last seat are
 * serialised by the database: one gets seats, the other gets `sold_out`.
 */
export async function createHold(input: HoldInput): Promise<HoldResult> {
  const now = input.now ?? new Date();
  const holdMinutes = input.holdMinutes ?? HOLDS.onlineMinutes;
  const channel = input.channel ?? "online";

  return db.transaction(async (tx) => {
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(orders)
        .where(eq(orders.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) {
        return {
          orderId: existing.id,
          customerId: existing.customerId,
          totalPaise: existing.totalPaise,
          expiresAt: existing.expiresAt ?? now,
          reused: true,
        };
      }
    }

    // Lock order: event row first, then the tier. Always the same order, so
    // two concurrent holds can never deadlock each other.
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, input.eventId))
      .for("update");

    if (!event) throw new DomainError("not_found", "That event does not exist.");

    const [tier] = await tx
      .select()
      .from(ticketTypes)
      .where(and(eq(ticketTypes.id, input.ticketTypeId), eq(ticketTypes.eventId, event.id)))
      .for("update");

    if (!tier) throw new DomainError("not_found", "That ticket type is not on this event.");

    if (input.quantity < 1) throw new DomainError("invalid_state", "Pick at least one ticket.");
    if (tier.perOrderLimit > 0 && input.quantity > tier.perOrderLimit) {
      throw new DomainError(
        "limit_exceeded",
        `Up to ${tier.perOrderLimit} tickets per order.`,
      );
    }

    if (tier.saleEndsAt && tier.saleEndsAt.getTime() < now.getTime()) {
      throw new DomainError("expired", "Ticket sales have closed for this tier.");
    }
    if (tier.saleStartsAt && tier.saleStartsAt.getTime() > now.getTime()) {
      throw new DomainError("invalid_state", "This tier is not on sale yet.");
    }

    const tierTaken = await seatsTaken(tx, eq(tickets.ticketTypeId, tier.id), now);
    const tierLeft = tier.quantity - tierTaken;
    if (input.quantity > tierLeft) {
      throw new DomainError(
        "sold_out",
        tierLeft === 0
          ? `The last ${tier.name} ticket just went.`
          : `Only ${tierLeft} left in ${tier.name}.`,
        { available: Math.max(tierLeft, 0) },
      );
    }

    if (event.capacity > 0) {
      const eventTaken = await seatsTaken(tx, eq(orders.eventId, event.id), now);
      if (eventTaken + input.quantity > event.capacity) {
        throw new DomainError("sold_out", "This event is sold out.", {
          available: Math.max(event.capacity - eventTaken, 0),
        });
      }
    }

    const customer = await upsertCustomer(tx, input.customer);
    const totalPaise = tier.pricePaise * input.quantity;
    const expiresAt = new Date(now.getTime() + holdMinutes * 60_000);

    const [order] = await tx
      .insert(orders)
      .values({
        customerId: customer.id,
        eventId: event.id,
        channel,
        status: "pending",
        totalPaise,
        expiresAt,
        soldBy: input.soldBy ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        utmSnapshot: input.customer.utm as Record<string, string> | null | undefined,
        approvalStatus: input.approval ? "pending" : "not_required",
        approvalExpiresAt: input.approval ? expiresAt : null,
      })
      .returning();

    await tx.insert(tickets).values(
      Array.from({ length: input.quantity }, () => ({
        orderId: order.id,
        eventId: event.id,
        ticketTypeId: tier.id,
        holderName: input.customer.name,
        holderPhone: input.customer.phone,
        petName: null,
        petBreed: null,
        qrToken: null,
        status: "void" as const,
      })),
    );

    return {
      orderId: order.id,
      customerId: customer.id,
      totalPaise,
      expiresAt,
      reused: false,
    };
  });
}

/**
 * Free seats whose hold lapsed. Run from cron; safe to run twice.
 */
export async function expireStaleHolds(now = new Date()) {
  const expiredSales = await db
    .update(orders)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(orders.status, "pending"),
        ne(orders.approvalStatus, "pending"),
        isNotNull(orders.expiresAt),
        lt(orders.expiresAt, now),
      ),
    )
    .returning({ id: orders.id });

  return { expiredOnline: expiredSales.length };
}

export type Availability = {
  tierId: number;
  quantity: number;
  taken: number;
  left: number;
};

export async function availabilityFor(eventId: number, now = new Date()) {
  const rows = await db
    .select({
      tierId: ticketTypes.id,
      quantity: ticketTypes.quantity,
      taken: sql<number>`count(${tickets.id})::int`,
    })
    .from(ticketTypes)
    .leftJoin(tickets, eq(tickets.ticketTypeId, ticketTypes.id))
    .leftJoin(orders, eq(tickets.orderId, orders.id))
    .where(
      and(
        eq(ticketTypes.eventId, eventId),
        or(sql`${orders.id} is null`, occupiesSeat(now)),
      ),
    )
    .groupBy(ticketTypes.id, ticketTypes.quantity)
    .orderBy(ticketTypes.id);

  return rows.map<Availability>((r) => ({
    tierId: r.tierId,
    quantity: r.quantity,
    taken: r.taken,
    left: Math.max(r.quantity - r.taken, 0),
  }));
}

/** Used by the poller that raises an owner alert for a slow cash approval. */
export async function alertStaleApprovals(now = new Date(), thresholdMinutes = 5) {
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60_000);
  const stale = await db
    .select({ id: orders.id, eventId: orders.eventId, totalPaise: orders.totalPaise })
    .from(orders)
    .where(and(eq(orders.approvalStatus, "pending"), lt(orders.createdAt, cutoff)));

  let alerted = 0;
  for (const order of stale) {
    const body = `Order #${order.id} has been pending for more than ${thresholdMinutes} minutes.`;

    // The poller runs every few minutes; the owner should get one alert per
    // order, not one per poll.
    const [already] = await db
      .select({ id: ownerAlerts.id })
      .from(ownerAlerts)
      .where(and(eq(ownerAlerts.type, "cash_approval_waiting"), eq(ownerAlerts.body, body)))
      .limit(1);
    if (already) continue;

    await db.insert(ownerAlerts).values({
      type: "cash_approval_waiting",
      severity: "warn",
      eventId: order.eventId,
      title: `Cash sale waiting for approval · ₹${(order.totalPaise / 100).toFixed(0)}`,
      body,
    });
    alerted += 1;
  }
  return { alerted };
}
