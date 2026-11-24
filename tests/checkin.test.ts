import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";
import { checkIn, normaliseToken } from "@/lib/domain/checkin";
import { createHold } from "@/lib/domain/inventory";
import { markPaid } from "@/lib/domain/payments";
import { buyer, resetDb, seedEvent, seedStaff } from "./helpers";

async function soldTicket() {
  const { event, tier } = await seedEvent({ capacity: 5, tierQuantity: 5 });
  const hold = await createHold({
    eventId: event.id,
    ticketTypeId: tier.id,
    quantity: 1,
    customer: buyer("+919000000201"),
  });
  const paid = await markPaid(hold.orderId, {
    providerPaymentId: "pay_scan_1",
    amountPaise: hold.totalPaise,
    method: "upi",
  });
  return { token: paid.ticketTokens[0], event };
}

describe("check-in", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("admits a valid ticket exactly once", async () => {
    const { token } = await soldTicket();
    const { seller } = await seedStaff();

    const first = await checkIn(token, seller.id, "phone-a");
    expect(first.result).toBe("admitted");

    const second = await checkIn(token, seller.id, "phone-a");
    expect(second.result).toBe("already_used");
    if (second.result === "already_used") {
      expect(second.checkedInAt).toBeInstanceOf(Date);
    }
  });

  it("lets exactly one of 10 simultaneous scans win", async () => {
    const { token } = await soldTicket();
    const { seller } = await seedStaff();

    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) => checkIn(token, seller.id, `device-${i}`)),
    );

    const admitted = outcomes.filter((o) => o.result === "admitted");
    const used = outcomes.filter((o) => o.result === "already_used");
    expect(admitted).toHaveLength(1);
    expect(used).toHaveLength(9);

    const [row] = await db.select().from(tickets).where(eq(tickets.qrToken, token));
    expect(row.status).toBe("checked_in");
    expect(row.checkedInAt).not.toBeNull();
  });

  it("reports not_found rather than throwing on a junk token", async () => {
    const outcome = await checkIn("not-a-real-token", null, "phone-b");
    expect(outcome.result).toBe("not_found");
  });

  it("accepts a full ticket URL as well as a bare token", () => {
    expect(normaliseToken("http://localhost:3000/ticket/abc123_-x")).toBe("abc123_-x");
    expect(normaliseToken("  abc123_-x  ")).toBe("abc123_-x");
    expect(normaliseToken("")).toBe("");
  });
});
