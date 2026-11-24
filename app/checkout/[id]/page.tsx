import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Countdown } from "@/components/countdown";
import { payWithMockGateway } from "@/app/actions/checkout";
import { PublicFooter, PublicHeader } from "@/components/chrome";
import { optionalStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatPaise, maskPhone } from "@/lib/format";
import { orderSummary, ticketsForOrder } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isFinite(orderId)) notFound();

  const session = await optionalStaff();
  const summary = await orderSummary(orderId);
  if (!summary) notFound();

  const issues = await ticketsForOrder(orderId);
  const paid = summary.order.status === "paid" || summary.order.status === "partially_refunded";
  const expired = summary.order.status === "expired";

  if (paid) {
    const first = issues.find((t) => t.qrToken);
    redirect(first?.qrToken ? `/ticket/${first.qrToken}` : "/");
  }

  const razorpayMode = process.env.PAYMENTS_MODE === "razorpay";
  const total = summary.order.totalPaise;

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader session={session} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-accent">
          Step 2 of 2 · Payment
        </p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Almost in</h1>
        <p className="mt-1 text-sm text-ink-soft">
          We are holding {issues.length} {issues.length === 1 ? "seat" : "seats"} while you pay.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-[1.1fr_0.9fr]">
          <section className="card p-5">
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
              Your order
            </h2>
            <p className="mt-2 text-lg font-bold">{summary.eventTitle}</p>
            <p className="text-sm text-ink-soft">{formatIstDateTime(summary.startsAt)}</p>
            <p className="text-sm text-muted">{summary.venueName || "Venue to be announced"}</p>

            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Order</dt>
                <dd className="font-semibold tabular-nums">#{summary.order.id}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Attendee</dt>
                <dd className="font-semibold">{summary.customerName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Mobile</dt>
                <dd className="font-semibold tabular-nums">{maskPhone(summary.customerPhone)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Tickets</dt>
                <dd className="font-semibold tabular-nums">{issues.length}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-2 text-base">
                <dt className="font-bold">Total</dt>
                <dd className="font-bold tabular-nums">{formatPaise(total)}</dd>
              </div>
            </dl>

            {summary.order.expiresAt && !expired ? (
              <p className="mt-4 rounded-xl border border-[#ecd9a6] bg-warn-soft px-3 py-2 text-xs font-semibold text-warn">
                <Countdown to={summary.order.expiresAt.toISOString()} />
                {" — after that the seats go back on sale."}
              </p>
            ) : null}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
              Pay {formatPaise(total)}
            </h2>

            {expired ? (
              <div className="mt-3">
                <p className="rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-sm font-semibold text-bad">
                  This hold expired before payment. The seats were released.
                </p>
                <Link
                  href={`/e/${summary.eventSlug}`}
                  className="btn btn-primary mt-3 w-full"
                >
                  Start again
                </Link>
              </div>
            ) : razorpayMode ? (
              <div className="mt-3">
                <RazorpaySection orderId={orderId} amountPaise={total} />
              </div>
            ) : (
              <form action={payWithMockGateway} className="mt-3">
                <input type="hidden" name="orderId" value={orderId} />
                <button type="submit" className="btn btn-primary w-full">
                  Pay {formatPaise(total)} · test mode
                </button>
                <p className="mt-2 text-center text-[0.7rem] text-muted">
                  No money moves. This simulates a successful UPI payment and issues the real
                  tickets through the same code path as the live gateway.
                </p>
              </form>
            )}

            <div className="mt-5 border-t border-line pt-4 text-xs leading-relaxed text-muted">
              The QR code is issued only after the payment is confirmed server-side. Closing this
              page does not cancel the hold.
            </div>
          </section>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Wrong details?{" "}
          <Link href={`/e/${summary.eventSlug}`} className="font-bold underline">
            Start over
          </Link>
        </p>
      </main>

      <PublicFooter />
    </div>
  );
}

/** Kept async so the Razorpay bundle is only pulled in when that mode runs. */
async function RazorpaySection({ orderId, amountPaise }: { orderId: number; amountPaise: number }) {
  const { RazorpayPay } = await import("@/components/razorpay-pay");
  return <RazorpayPay orderId={orderId} amountPaise={amountPaise} />;
}
