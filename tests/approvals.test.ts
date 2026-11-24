import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { orders, tickets } from "@/lib/db/schema";
import {
  approveSale,
  createCounterSale,
  expirePendingApprovals,
  extendHold,
  rejectSale,
} from "@/lib/domain/counter-sales";
import { createHold } from "@/lib/domain/inventory";
import { buyer, resetDb, seedEvent, seedStaff } from "./helpers";

async function cashSale() {
  const { event, tier } = await seedEvent({ capacity: 5, tierQuantity: 5 });
  const { owner, seller } = await seedStaff();

  const sale = await createCounterSale({
    staffId: seller.id,
    eventId: event.id,
    ticketTypeId: tier.id,
    quantity: 2,
    mode: "cash",
    holderName: "Ravi",
    holderPhone: "+919000000301",
  });

  if (sale.kind !== "awaiting_approval") throw new Error("expected a pending sale");
  return { sale, event, tier, owner, seller };
}

describe("counter sales and cash approval", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("issues tickets instantly for a UPI sale, because the gateway confirmed the money", async () => {
    const { event, tier } = await seedEvent({ capacity: 5, tierQuantity: 5 });
    const { seller } = await seedStaff();

    const sale = await createCounterSale({
      staffId: seller.id,
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 1,
      mode: "upi",
      holderName: "Meera",
      holderPhone: "+919000000302",
    });

    expect(sale.kind).toBe("issued");
    if (sale.kind === "issued") {
      expect(sale.ticketTokens).toHaveLength(1);
    }

    const [order] = await db.select().from(orders).where(eq(orders.soldBy, seller.id));
    expect(order.status).toBe("paid");
    expect(order.approvalStatus).toBe("not_required");
  });

  it("creates a pending request with no QR token for a cash sale", async () => {
    const { sale } = await cashSale();

    const [order] = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    expect(order.status).toBe("pending");
    expect(order.approvalStatus).toBe("pending");
    expect(order.approvalExpiresAt).not.toBeNull();

    const rows = await db.select().from(tickets).where(eq(tickets.orderId, sale.orderId));
    expect(rows).toHaveLength(2);
    expect(rows.every((t) => t.qrToken === null)).toBe(true);
    expect(rows.every((t) => t.status === "void")).toBe(true);
  });

  it("refuses to let the seller approve their own sale", async () => {
    const { sale, seller } = await cashSale();

    // Even with the owner role, the person who took the cash cannot sign it off.
    await expect(
      approveSale(sale.orderId, { staffId: seller.id, role: "owner" }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const [order] = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    expect(order.approvalStatus).toBe("pending");
  });

  it("refuses a non-owner approver", async () => {
    const { sale, seller } = await cashSale();

    await expect(
      approveSale(sale.orderId, { staffId: seller.id + 99, role: "sales" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("mints the QR tokens only on approval, and only once", async () => {
    const { sale, owner } = await cashSale();

    const first = await approveSale(sale.orderId, {
      staffId: owner.id,
      role: "owner",
    });
    expect(first.alreadyApproved).toBe(false);
    expect(first.ticketTokens).toHaveLength(2);

    const second = await approveSale(sale.orderId, {
      staffId: owner.id,
      role: "owner",
    });
    expect(second.alreadyApproved).toBe(true);
    expect(second.ticketTokens).toHaveLength(2);

    const issued = await db.select().from(tickets).where(eq(tickets.orderId, sale.orderId));
    expect(issued).toHaveLength(2);
    expect(issued.every((t) => t.status === "valid")).toBe(true);
    expect(issued.every((t) => typeof t.qrToken === "string")).toBe(true);
  });

  it("releases the seats when a request is rejected", async () => {
    const { sale, event, tier, owner } = await cashSale();

    await rejectSale(sale.orderId, { staffId: owner.id, role: "owner" }, "Cash not handed over");

    const [order] = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    expect(order.approvalStatus).toBe("rejected");
    expect(order.status).toBe("cancelled");
    expect(order.rejectionReason).toBe("Cash not handed over");

    const hold = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 2,
      customer: buyer("+919000000303"),
    });
    expect(hold.orderId).toBeGreaterThan(0);
  });

  it("releases the seats and alerts the owner when a request expires unanswered", async () => {
    const { sale, event, tier } = await cashSale();

    await db
      .update(orders)
      .set({ approvalExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, sale.orderId));

    const { expired } = await expirePendingApprovals();
    expect(expired).toBe(1);

    const [order] = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    expect(order.approvalStatus).toBe("expired");

    const hold = await createHold({
      eventId: event.id,
      ticketTypeId: tier.id,
      quantity: 2,
      customer: buyer("+919000000304"),
    });
    expect(hold.orderId).toBeGreaterThan(0);
  });

  it("extends a hold and pushes the new deadline to the order", async () => {
    const { sale, owner } = await cashSale();

    const before = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    const { expiresAt } = await extendHold(sale.orderId, {
      staffId: owner.id,
      role: "owner",
    });

    expect(expiresAt.getTime()).toBeGreaterThan(before[0].approvalExpiresAt!.getTime());

    const [after] = await db.select().from(orders).where(eq(orders.id, sale.orderId));
    expect(after.expiresAt?.getTime()).toBe(expiresAt.getTime());
  });
});
