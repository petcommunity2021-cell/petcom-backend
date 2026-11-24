import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orders, tickets } from "@/lib/db/schema";
import { createHold, expireStaleHolds } from "@/lib/domain/inventory";
import { DomainError } from "@/lib/domain/errors";
import { buyer, resetDb, seedEvent } from "./helpers";

describe("inventory holds", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reserves seats and creates placeholder tickets with no QR token", async () => {
    const { event, tier } = await seedEvent({ capacity: 5, tierQuantity: 5 });

    const hold = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 2,
      customer: buyer("+919000000001"),
    });

    expect(hold.totalPaise).toBe(59900 * 2);

    const rows = await db.select().from(tickets).where(eq(tickets.orderId, hold.orderId));
    expect(rows).toHaveLength(2);
    expect(rows.every((t) => t.status === "void")).toBe(true);
    expect(rows.every((t) => t.qrToken === null)).toBe(true);
  });

  it("lets exactly one of 20 concurrent buyers win the last seat", async () => {
    const { event, tier } = await seedEvent({ capacity: 1, tierQuantity: 1 });

    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createHold({
          eventId: event.id,
          ticketTypeId: tier.id,
          quantity: 1,
          customer: buyer(`+9190000000${String(i).padStart(2, "0")}`),
        }),
      ),
    );

    const won = attempts.filter((a) => a.status === "fulfilled");
    const lost = attempts.filter((a) => a.status === "rejected");

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(19);
    for (const loss of lost) {
      const reason = (loss as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(DomainError);
      expect(reason.code).toBe("sold_out");
    }

    const held = await db.select().from(orders).where(eq(orders.status, "pending"));
    expect(held).toHaveLength(1);
  });

  it("rejects a quantity above the per-order limit", async () => {
    const { event, tier } = await seedEvent({ capacity: 50, tierQuantity: 50 });

    await expect(
      createHold({
        eventId: event.id,
        ticketTypeId: tier.id,
        quantity: 11,
        customer: buyer("+919000000010"),
      }),
    ).rejects.toMatchObject({ code: "limit_exceeded" });
  });

  it("reuses the same order for a repeated idempotency key", async () => {
    const { event, tier } = await seedEvent({ capacity: 10, tierQuantity: 10 });

    const first = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 1,
      customer: buyer("+919000000011"),
      idempotencyKey: "checkout-abc-123",
    });

    const second = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 1,
      customer: buyer("+919000000011"),
      idempotencyKey: "checkout-abc-123",
    });

    expect(second.orderId).toBe(first.orderId);
    expect(second.reused).toBe(true);

    const all = await db.select().from(orders);
    expect(all).toHaveLength(1);
  });

  it("frees the seat when a hold expires", async () => {
    const { event, tier } = await seedEvent({ capacity: 1, tierQuantity: 1 });

    const first = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 1,
      customer: buyer("+919000000012"),
      holdMinutes: 10,
    });

    await expect(
      createHold({
        eventId: event.id,
        ticketTypeId: tier.id,
        quantity: 1,
        customer: buyer("+919000000013"),
      }),
    ).rejects.toMatchObject({ code: "sold_out" });

    // Time passes and the hold lapses: the seat is no longer occupied.
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, first.orderId));

    const retry = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 1,
      customer: buyer("+919000000013"),
    });
    expect(retry.orderId).toBeGreaterThan(first.orderId);

    // ...and the sweeper closes the abandoned order out properly.
    const { expiredOnline } = await expireStaleHolds();
    expect(expiredOnline).toBe(1);

    const [stale] = await db.select().from(orders).where(eq(orders.id, first.orderId));
    expect(stale.status).toBe("expired");
  });
});
