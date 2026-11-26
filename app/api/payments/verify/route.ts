import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { orders } from "@/lib/db/schema";
import { markPaid } from "@/lib/domain/payments";
import {
  fetchRazorpayPayment,
  verifyRazorpaySignature,
} from "@/lib/domain/payments-provider";
import { DomainError } from "@/lib/domain/errors";

/**
 * The browser callback. A valid signature proves Razorpay signed this payment,
 * but the amount is still re-read from Razorpay's API before tickets exist —
 * the browser must never be able to say "it was ₹1".
 */
export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Razorpay is not configured." }, { status: 503 });
  }

  let body: {
    orderId?: unknown;
    razorpay_payment_id?: unknown;
    razorpay_order_id?: unknown;
    razorpay_signature?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const orderId = Number(body.orderId);
  const paymentId = String(body.razorpay_payment_id ?? "");
  const providerOrderId = String(body.razorpay_order_id ?? "");
  const signature = String(body.razorpay_signature ?? "");

  if (!orderId || !paymentId || !providerOrderId || !signature) {
    return NextResponse.json({ error: "Incomplete payment response." }, { status: 400 });
  }

  const signed = verifyRazorpaySignature(
    `${providerOrderId}|${paymentId}`,
    signature,
    secret,
  );
  if (!signed) {
    return NextResponse.json({ error: "Signature check failed." }, { status: 400 });
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return NextResponse.json({ error: "Unknown order." }, { status: 404 });
  if (order.razorpayOrderId && order.razorpayOrderId !== providerOrderId) {
    return NextResponse.json({ error: "That payment belongs to another order." }, { status: 409 });
  }

  try {
    const payment = await fetchRazorpayPayment(paymentId);

    if (payment.order_id !== providerOrderId) {
      return NextResponse.json({ error: "Payment/order mismatch." }, { status: 409 });
    }
    if (payment.status !== "captured") {
      return NextResponse.json(
        { error: `Payment is ${payment.status}, not captured.` },
        { status: 409 },
      );
    }
    if (payment.amount !== order.totalPaise) {
      return NextResponse.json(
        { error: "The amount paid does not match this order." },
        { status: 409 },
      );
    }

    const paid = await markPaid(orderId, {
      providerPaymentId: payment.id,
      amountPaise: payment.amount,
      method: payment.method,
      raw: payment,
    });

    const token = paid.ticketTokens[0];
    return NextResponse.json({ redirect: token ? `/ticket/${token}` : "/" });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("payment verification failed", error);
    return NextResponse.json({ error: "Payment could not be confirmed." }, { status: 502 });
  }
}
