"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

type Props = { orderId: number; amountPaise: number };

/**
 * Razorpay Checkout popup. The browser only ever receives the *order* id and
 * the public key; the payment is confirmed server-side in
 * `/api/payments/verify`, never here.
 */
export function RazorpayPay({ orderId, amountPaise }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "opening" | "confirming" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.Razorpay) return;
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  async function pay() {
    setStatus("opening");
    setMessage(null);
    try {
      const res = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = (await res.json()) as {
        keyId?: string;
        providerOrderId?: string;
        amountPaise?: number;
        error?: string;
      };
      if (!res.ok || !data.providerOrderId || !data.keyId) {
        throw new Error(data.error ?? "Could not start the payment.");
      }

      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("The payment window did not load. Check your connection.");

      const checkout = new Razorpay({
        key: data.keyId,
        order_id: data.providerOrderId,
        amount: data.amountPaise ?? amountPaise,
        currency: "INR",
        name: "Petcom",
        description: "Event tickets",
        theme: { color: "#0f766e" },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          setStatus("confirming");
          const verify = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId, ...response }),
          });
          const result = (await verify.json()) as { redirect?: string; error?: string };
          if (verify.ok && result.redirect) {
            router.push(result.redirect);
          } else {
            setStatus("error");
            setMessage(result.error ?? "The payment could not be confirmed. Nothing was charged.");
          }
        },
        modal: {
          ondismiss: () => setStatus("idle"),
        },
      });

      checkout.open();
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage((error as Error).message);
    }
  }

  return (
    <div>
      <button type="button" className="btn btn-primary w-full" onClick={pay} disabled={status === "opening" || status === "confirming"}>
        {status === "opening"
          ? "Opening Razorpay…"
          : status === "confirming"
            ? "Confirming payment…"
            : "Pay with Razorpay"}
      </button>
      {message ? (
        <p className="mt-3 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
          {message}
        </p>
      ) : null}
      <p className="mt-2 text-center text-[0.7rem] text-muted">
        UPI, cards and netbanking. The ticket is issued only after the server confirms the payment.
      </p>
    </div>
  );
}
