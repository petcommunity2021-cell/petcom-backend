import { createHmac, timingSafeEqual } from "node:crypto";

export type ProviderOrder = { providerOrderId: string; amountPaise: number; currency: "INR" };

export interface PaymentProvider {
  readonly name: "mock" | "razorpay";
  /** Create the gateway order the browser will pay against. */
  createOrder(input: {
    orderId: number;
    amountPaise: number;
    receipt: string;
  }): Promise<ProviderOrder>;
}

class MockProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async createOrder(input: { orderId: number; amountPaise: number }): Promise<ProviderOrder> {
    return {
      providerOrderId: `order_mock_${input.orderId}_${Date.now().toString(36)}`,
      amountPaise: input.amountPaise,
      currency: "INR",
    };
  }
}

class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay" as const;
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  async createOrder(input: {
    orderId: number;
    amountPaise: number;
    receipt: string;
  }): Promise<ProviderOrder> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt,
        notes: { petcom_order_id: String(input.orderId) },
      }),
    });

    if (!res.ok) {
      throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { id: string; amount: number };
    return { providerOrderId: json.id, amountPaise: json.amount, currency: "INR" };
  }
}

export function getProvider(): PaymentProvider {
  const mode = process.env.PAYMENTS_MODE ?? "mock";
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (mode === "razorpay" && keyId && keySecret) {
    return new RazorpayProvider(keyId, keySecret);
  }
  return new MockProvider();
}

/**
 * Razorpay signs `order_id|payment_id` with the key secret. Compare in
 * constant time, on the *raw* request body — never on a re-serialised object.
 */
export function verifyRazorpaySignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Server-side confirmation: a signature can be forged by anyone who has the
 * secret, so the amount is re-read from Razorpay before an order is marked paid.
 */
export async function fetchRazorpayPayment(paymentId: string) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("Razorpay keys are not configured");

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`Razorpay fetch failed: ${res.status}`);
  return (await res.json()) as {
    id: string;
    order_id: string;
    amount: number;
    status: string;
    method: string;
  };
}
