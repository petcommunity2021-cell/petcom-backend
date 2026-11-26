import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders, webhookEvents } from "@/lib/db/schema";
import { DomainError } from "@/lib/domain/errors";
import { markPaid } from "@/lib/domain/payments";
import { verifyRazorpaySignature } from "@/lib/domain/payments-provider";

type RazorpayWebhook = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string | null;
        amount?: number;
        method?: string | null;
        status?: string;
      };
    };
  };
};

/**
 * Server-side confirmation, independent of the browser. The browser can close,
 * lose network or lie; this endpoint is what makes a ticket real.
 *
 * Signed with the webhook secret over the *raw* body. Deduplicated by the
 * `x-razorpay-event-id` header, because Razorpay retries.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured." }, { status: 503 });
  }
  if (!verifyRazorpaySignature(raw, signature, secret)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  let event: RazorpayWebhook;
  try {
    event = JSON.parse(raw) as RazorpayWebhook;
  } catch {
    return NextResponse.json({ error: "Malformed JSON." }, { status: 400 });
  }

  const type = event.event ?? "unknown";
  const providerEventId = eventId || `body_${Buffer.from(raw).toString("base64url").slice(0, 40)}`;

  // One row per delivery. A retry hits the unique index and returns early, so
  // `markPaid` is never called twice for the same notification.
  const inserted = await db
    .insert(webhookEvents)
    .values({
      provider: "razorpay",
      providerEventId,
      eventType: type,
      payload: event as never,
    })
    .onConflictDoNothing({
      target: [webhookEvents.provider, webhookEvents.providerEventId],
    })
    .returning({ id: webhookEvents.id });

  if (inserted.length === 0) {
    return NextResponse.json({ duplicate: true });
  }
  const rowId = inserted[0].id;

  if (type !== "payment.captured") {
    // Nothing to do yet — order.paid arrives with its own payment.captured.
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date() })
      .where(eq(webhookEvents.id, rowId));
    return NextResponse.json({ ignored: type });
  }

  const payment = event.payload?.payment?.entity;
  const providerOrderId = payment?.order_id ?? "";
  const providerPaymentId = payment?.id ?? "";

  if (!providerOrderId || !providerPaymentId) {
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: "Payment payload missing ids" })
      .where(eq(webhookEvents.id, rowId));
    return NextResponse.json({ ignored: "missing_ids" });
  }

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.razorpayOrderId, providerOrderId))
    .limit(1);

  if (!order) {
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: `No order for ${providerOrderId}` })
      .where(eq(webhookEvents.id, rowId));
    return NextResponse.json({ ignored: "unknown_order" });
  }

  try {
    await markPaid(order.id, {
      providerPaymentId,
      amountPaise: payment?.amount ?? 0,
      method: payment?.method ?? "unknown",
      raw: event,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), error: message })
      .where(eq(webhookEvents.id, rowId));

    // An amount mismatch is not transient: retrying will never fix it. Store
    // it for the owner and answer 200 so Razorpay stops retrying.
    if (error instanceof DomainError) {
      return NextResponse.json({ recorded: true, problem: message });
    }
    return NextResponse.json({ error: "Could not process webhook." }, { status: 500 });
  }

  await db
    .update(webhookEvents)
    .set({ processedAt: new Date() })
    .where(eq(webhookEvents.id, rowId));

  return NextResponse.json({ ok: true, orderId: order.id });
}
