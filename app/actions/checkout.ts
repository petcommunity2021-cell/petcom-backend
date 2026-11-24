"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { DomainError } from "@/lib/domain/errors";
import { createHold } from "@/lib/domain/inventory";
import { markPaid } from "@/lib/domain/payments";
import { normalisePhone } from "@/lib/format";

export type CheckoutState = { error: string | null };



function readUtm(formData: FormData) {
  return {
    utm_source: String(formData.get("utm_source") ?? "") || null,
    utm_medium: String(formData.get("utm_medium") ?? "") || null,
    utm_campaign: String(formData.get("utm_campaign") ?? "") || null,
    fbclid: String(formData.get("fbclid") ?? "") || null,
  };
}

/**
 * Step one of checkout: take the seats off the shelf before anyone pays, so a
 * slow buyer cannot be overtaken by a fast one.
 */
export async function startCheckout(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const eventId = Number(formData.get("eventId"));
  const ticketTypeId = Number(formData.get("ticketTypeId"));
  const quantity = Number(formData.get("quantity"));
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const consent = formData.get("consent") === "on";

  if (!name) return { error: "Add the name that should be printed on the ticket." };
  if (!email.includes("@")) return { error: "We need an email to send the ticket to." };
  if (!Number.isFinite(quantity) || quantity < 1) return { error: "Pick at least one ticket." };

  let phone: string;
  try {
    phone = normalisePhone(String(formData.get("phone") ?? ""));
  } catch (error) {
    return { error: (error as Error).message };
  }

  let orderId: number;
  try {
    const hold = await createHold({
      eventId,
      ticketTypeId,
      quantity,
      customer: { name, phone, email, utm: readUtm(formData), consentMarketing: consent },
    });
    orderId = hold.orderId;
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    console.error("checkout failed", error);
    return { error: "Something went wrong holding your seats. Please try again." };
  }

  redirect(`/checkout/${orderId}`);
}

/**
 * The mock gateway. It exists so the whole ticket lifecycle can be exercised
 * without Razorpay keys; it deliberately goes through `markPaid`, exactly like
 * a real webhook, so there is only ever one path that mints a QR code.
 */
export async function payWithMockGateway(formData: FormData) {
  const orderId = Number(formData.get("orderId"));
  if (!Number.isFinite(orderId)) redirect("/");

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) redirect("/");
  if (order.status === "paid") {
    const { tickets } = await import("@/lib/db/schema");
    const [first] = await db.select().from(tickets).where(eq(tickets.orderId, orderId)).limit(1);
    redirect(first?.qrToken ? `/ticket/${first.qrToken}` : "/");
  }

  const result = await markPaid(orderId, {
    providerPaymentId: `pay_mock_${orderId}_${Date.now().toString(36)}`,
    amountPaise: order.totalPaise,
    method: "upi",
    raw: { source: "mock_checkout", at: new Date().toISOString() },
  });

  if (result.ticketTokens.length === 0) redirect("/");
  redirect(`/ticket/${result.ticketTokens[0]}`);
}
