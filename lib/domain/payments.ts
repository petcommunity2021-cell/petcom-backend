import { and, eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { firstRow } from "@/lib/db/rows";
import { messages, orders, payments, tickets } from "@/lib/db/schema";
import { recordPurchase } from "@/lib/domain/customers";
import { DomainError } from "@/lib/domain/errors";
import { generateQrToken } from "@/lib/domain/tickets";

export type PaidInput = {
  providerPaymentId: string;
  amountPaise: number;
  method: string;
  raw?: unknown;
};

export type PaidResult = {
  orderId: number;
  alreadyPaid: boolean;
  ticketTokens: string[];
};

/**
 * The single write path from "money arrived" to "ticket exists".
 *
 * Called by the payment callback and by the webhook, so it must be safe to
 * call twice: the order row is locked, and a second call short-circuits to
 * the existing tokens instead of minting new ones.
 */
export async function markPaid(orderId: number, input: PaidInput): Promise<PaidResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update");

    if (!order) throw new DomainError("not_found", "Order not found.");

    if (order.status === "paid" || order.status === "partially_refunded") {
      const existing = await tx
        .select({ token: tickets.qrToken })
        .from(tickets)
        .where(eq(tickets.orderId, orderId));
      return {
        orderId,
        alreadyPaid: true,
        ticketTokens: existing.map((t) => t.token).filter((t): t is string => Boolean(t)),
      };
    }

    if (order.status === "refunded" || order.status === "cancelled") {
      throw new DomainError("invalid_state", "This order is closed.");
    }

    if (order.status === "expired") {
      // Late payment: only honour it if the seats are genuinely still free.
      const capacity = await seatsLeftForOrder(tx, order.eventId, order.id);
      if (capacity < 1) {
        throw new DomainError(
          "sold_out",
          "Paid after the hold expired and the event has since sold out — refund needed.",
          { needsRefund: true },
        );
      }
    }

    if (input.amountPaise !== order.totalPaise) {
      throw new DomainError(
        "amount_mismatch",
        `Amount paid (${input.amountPaise}) does not match the order (${order.totalPaise}).`,
      );
    }

    const now = new Date();

    await tx
      .update(orders)
      .set({
        status: "paid",
        updatedAt: now,
        approvalStatus:
          order.approvalStatus === "pending" ? "approved" : order.approvalStatus,
        approvedAt: order.approvalStatus === "pending" ? now : order.approvedAt,
      })
      .where(eq(orders.id, orderId));

    const issued = await issueTickets(tx, orderId);

    await tx
      .insert(payments)
      .values({
        orderId,
        razorpayPaymentId: input.providerPaymentId,
        amountPaise: input.amountPaise,
        method: input.method,
        status: "captured",
        capturedAt: now,
        rawWebhook: (input.raw ?? null) as never,
      })
      .onConflictDoNothing({ target: payments.razorpayPaymentId });

    await queueTicketMessages(tx, orderId, issued);
    await recordPurchase(tx, order.customerId, order.totalPaise, order.eventId);

    return {
      orderId,
      alreadyPaid: false,
      ticketTokens: issued.map((t) => t.token),
    };
  });
}

/** Flip void tickets to valid and mint their QR tokens. Returns the issued set. */
export async function issueTickets(tx: Tx, orderId: number) {
  const pending = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.orderId, orderId), eq(tickets.status, "void")));

  const issued: { id: number; token: string }[] = [];
  for (const ticket of pending) {
    const token = generateQrToken();
    await tx
      .update(tickets)
      .set({ status: "valid", qrToken: token })
      .where(eq(tickets.id, ticket.id));
    issued.push({ id: ticket.id, token });
  }
  return issued;
}

/** Delivery is queued, never sent inline — a slow mailer must not block a sale. */
async function queueTicketMessages(
  tx: Tx,
  orderId: number,
  issued: { id: number; token: string }[],
) {
  if (issued.length === 0) return;
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);

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

async function seatsLeftForOrder(tx: Tx, eventId: number, orderId: number) {
  const result = await tx.execute(sql`
    select (e.capacity - coalesce(count(t.id), 0))::int as left
    from events e
    left join tickets t on t.event_id = e.id
    left join orders o on o.id = t.order_id
    where e.id = ${eventId}
      and (o.id is null or o.status = 'paid' or o.id = ${orderId})
    group by e.capacity
  `);

  return firstRow<{ left: number }>(result)?.left ?? 0;
}
