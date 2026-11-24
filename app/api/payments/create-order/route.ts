import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { getProvider } from "@/lib/domain/payments-provider";

/**
 * Creates the gateway order for an existing Petcom order. The browser gets the
 * public key id and the provider order id — never the secret.
 */
export async function POST(request: Request) {
  let orderId = 0;
  try {
    const body = (await request.json()) as { orderId?: unknown };
    orderId = Number(body.orderId);
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!Number.isFinite(orderId) || orderId < 1) {
    return NextResponse.json({ error: "Unknown order." }, { status: 400 });
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return NextResponse.json({ error: "Unknown order." }, { status: 404 });
  if (order.status !== "pending") {
    return NextResponse.json({ error: "This order is not open for payment." }, { status: 409 });
  }

  const provider = getProvider();
  if (provider.name !== "razorpay") {
    return NextResponse.json(
      { error: "Live payments are off. Set PAYMENTS_MODE=razorpay with keys." },
      { status: 409 },
    );
  }

  try {
    const created = await provider.createOrder({
      orderId,
      amountPaise: order.totalPaise,
      receipt: `petcom_${orderId}`,
    });

    await db
      .update(orders)
      .set({ razorpayOrderId: created.providerOrderId, updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    return NextResponse.json({
      keyId: process.env.RAZORPAY_KEY_ID,
      providerOrderId: created.providerOrderId,
      amountPaise: created.amountPaise,
    });
  } catch (error) {
    console.error("razorpay order creation failed", error);
    return NextResponse.json({ error: "The payment could not be started." }, { status: 502 });
  }
}
