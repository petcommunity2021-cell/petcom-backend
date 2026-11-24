import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { messages, orders, payments, tickets } from "@/lib/db/schema";
import { createHold } from "@/lib/domain/inventory";
import { markPaid } from "@/lib/domain/payments";
import { buyer, resetDb, seedEvent } from "./helpers";

describe("payment confirmation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issues valid tickets with QR tokens when the payment matches", async () => {
    const { event, tier } = await seedEvent({ capacity: 5, tierQuantity: 5 });
    const hold = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 2,
      customer: buyer("+919000000101"),
    });

    const result = await markPaid(hold.orderId, {
      providerPaymentId: "pay_test_1",
      amountPaise: hold.totalPaise,
      method: "upi",
    });

    expect(result.alreadyPaid).toBe(false);
    expect(result.ticketTokens).toHaveLength(2);

    const issued = await db.select().from(tickets).where(eq(tickets.orderId, hold.orderId));
    expect(issued.every((t) => t.status === "valid")).toBe(true);
    expect(issued.every((t) => (t.qrToken?.length ?? 0) >= 22)).toBe(true);
    expect(new Set(issued.map((t) => t.qrToken)).size).toBe(2);

    const [order] = await db.select().from(orders).where(eq(orders.id, hold.orderId));
    expect(order.status).toBe("paid");
  });

  it("is idempotent: three deliveries produce one paid order, one ticket set, one queue entry", async () => {
    const { event, tier } = await seedEvent({ capacity: 5, tierQuantity: 5 });
    const hold = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 1,
      customer: buyer("+919000000102"),
    });

    const payload = {
      providerPaymentId: "pay_test_2",
      amountPaise: hold.totalPaise,
      method: "upi",
    };

    const [a, b, c] = await Promise.all([
      markPaid(hold.orderId, payload),
      markPaid(hold.orderId, payload),
      markPaid(hold.orderId, payload),
    ]);

    expect([a, b, c].filter((r) => !r.alreadyPaid).length).toBe(1);

    const paidOrders = await db.select().from(orders).where(eq(orders.status, "paid"));
    expect(paidOrders).toHaveLength(1);

    const issued = await db.select().from(tickets).where(eq(tickets.orderId, hold.orderId));
    expect(issued).toHaveLength(1);

    const queue = await db.select().from(messages).where(eq(messages.ticketId, issued[0].id));
    expect(queue).toHaveLength(1);

    const paymentRows = await db.select().from(payments).where(eq(payments.orderId, hold.orderId));
    expect(paymentRows).toHaveLength(1);
  });

  it("refuses a payment whose amount does not match the order", async () => {
    const { event, tier } = await seedEvent({ capacity: 5, tierQuantity: 5 });
    const hold = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 1,
      customer: buyer("+919000000103"),
    });

    await expect(
      markPaid(hold.orderId, {
        providerPaymentId: "pay_test_3",
        amountPaise: 1,
        method: "upi",
      }),
    ).rejects.toMatchObject({ code: "amount_mismatch" });

    const [order] = await db.select().from(orders).where(eq(orders.id, hold.orderId));
    expect(order.status).toBe("pending");
  });
});
