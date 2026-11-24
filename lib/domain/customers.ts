import { eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/lib/db/client";
import { customerActivity, customers, orders } from "@/lib/db/schema";

export type CustomerInput = {
  name: string;
  phone: string;
  email?: string | null;
  utm?: Record<string, string | null | undefined> | null;
  consentMarketing?: boolean;
};

/**
 * The CRM is keyed by phone. Every checkout, counter sale and lead upserts
 * through here, so a repeat buyer is one record and not five.
 */
export async function upsertCustomer(tx: Tx, input: CustomerInput) {
  const utm = input.utm ?? {};
  const [row] = await tx
    .insert(customers)
    .values({
      name: input.name,
      phone: input.phone,
      email: input.email ?? null,
      source: utm.utm_source ?? (utm.fbclid ? "facebook" : "direct"),
      utmSource: utm.utm_source ?? null,
      utmMedium: utm.utm_medium ?? null,
      utmCampaign: utm.utm_campaign ?? null,
      fbclid: utm.fbclid ?? null,
      consentMarketing: input.consentMarketing ?? false,
      consentAt: input.consentMarketing ? new Date() : null,
      stage: "lead",
    })
    .onConflictDoUpdate({
      target: customers.phone,
      set: {
        // Never overwrite a name the owner has curated with a blank form field.
        name: sql`case when ${customers.name} = '' then excluded.name else ${customers.name} end`,
        email: sql`coalesce(excluded.email, ${customers.email})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

/**
 * Called after an order is marked paid, inside the same transaction.
 * `repeat` is set from the second paid order onwards — the one field the
 * Repeat attendees view reads.
 */
export async function recordPurchase(
  tx: Tx,
  customerId: number,
  amountPaise: number,
  eventId: number,
) {
  const paid = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      sql`${orders.customerId} = ${customerId} and ${orders.status} in ('paid','partially_refunded')`,
    );

  await tx
    .update(customers)
    .set({
      stage: paid.length >= 2 ? "repeat" : "purchased",
      lifetimeValuePaise: sql`${customers.lifetimeValuePaise} + ${amountPaise}`,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));

  await tx.insert(customerActivity).values({
    customerId,
    type: "purchased",
    eventId,
    meta: { amountPaise, orderCount: paid.length },
  });
}

export async function findCustomerByPhone(phone: string) {
  const [row] = await db.select().from(customers).where(eq(customers.phone, phone)).limit(1);
  return row ?? null;
}

export async function activityFor(customerId: number) {
  return db
    .select()
    .from(customerActivity)
    .where(eq(customerActivity.customerId, customerId))
    .limit(50);
}

export async function customersByIds(ids: number[]) {
  if (ids.length === 0) return [];
  return db.select().from(customers).where(inArray(customers.id, ids));
}
