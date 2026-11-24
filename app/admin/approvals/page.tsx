import Link from "next/link";
import { approveCashSale, extendCashHold, rejectCashSale } from "@/app/actions/counter";
import { PageHead } from "@/components/chrome";
import { Countdown } from "@/components/countdown";
import { StaffShell } from "@/components/staff-shell";
import { requireStaff } from "@/lib/auth/guard";
import { formatPaise, relativeFromNow } from "@/lib/format";
import { pendingApprovals } from "@/lib/domain/counter-sales";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const session = await requireStaff(["owner"]);
  const { ok, error } = await searchParams;
  const requests = await pendingApprovals();

  return (
    <StaffShell session={session} active="/admin/approvals">
      <PageHead
        eyebrow="Cash & comps"
        title="Approvals"
        sub="A cash sale is a claim, not a payment. Approving it is what mints the QR code — and you cannot approve your own."
        actions={
          <Link href="/admin/orders" className="btn btn-ghost">
            All orders
          </Link>
        }
      />

      {ok ? (
        <p className="mt-4 rounded-xl border border-[#bfe0cc] bg-good-soft px-3 py-2.5 text-sm font-semibold text-good">
          {ok}
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-sm font-semibold text-bad">
          {error}
        </p>
      ) : null}

      {requests.length === 0 ? (
        <div className="card mt-5 p-8 text-center">
          <p className="text-lg font-bold">Nothing waiting</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
            Cash and comp sales appear here the moment a seller takes one. Until you act, the seats
            are held and no ticket exists anywhere.
          </p>
        </div>
      ) : (
        <ul className="mt-5 space-y-3">
          {requests.map((request) => {
            const isOwnSale = request.order.soldBy === session.staffId;
            return (
              <li key={request.order.id} className="card overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-cream/50 px-4 py-3">
                  <div>
                    <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                      Order #{request.order.id} · {request.ticketCount}{" "}
                      {request.ticketCount === 1 ? "ticket" : "tickets"}
                    </p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums">
                      {formatPaise(request.order.totalPaise)}
                    </p>
                    <p className="text-xs text-muted">{request.eventTitle}</p>
                  </div>
                  <div className="text-right text-xs">
                    <span className="pill pill-warn">
                      {request.order.channel === "comp" ? "comp" : "cash"} · waiting{" "}
                      {relativeFromNow(request.order.createdAt)}
                    </span>
                    {request.order.approvalExpiresAt ? (
                      <p className="mt-1.5 font-semibold text-warn">
                        <Countdown
                          to={request.order.approvalExpiresAt.toISOString()}
                          prefix="Expires in"
                          expiredLabel="Hold lapsed — seats free"
                        />
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                        Customer
                      </dt>
                      <dd className="font-semibold">{request.customerName}</dd>
                    </div>
                    <div>
                      <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                        Mobile
                      </dt>
                      <dd className="font-semibold tabular-nums">{request.customerPhone}</dd>
                    </div>
                    <div>
                      <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                        Taken by
                      </dt>
                      <dd className="font-semibold">
                        {request.soldByName ?? "—"}
                        {isOwnSale ? (
                          <span className="ml-1.5 pill pill-bad">that&rsquo;s you</span>
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                        Seats held until
                      </dt>
                      <dd className="font-semibold">
                        {request.order.approvalExpiresAt
                          ? new Date(request.order.approvalExpiresAt).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "numeric",
                              month: "short",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-col gap-2 sm:w-56">
                    <form action={approveCashSale}>
                      <input type="hidden" name="orderId" value={request.order.id} />
                      <button
                        type="submit"
                        className="btn btn-primary w-full"
                        disabled={isOwnSale}
                        title={
                          isOwnSale
                            ? "You took this sale — someone else has to approve it."
                            : "Approve and mint the QR codes"
                        }
                      >
                        {isOwnSale ? "Awaiting another owner" : "Approve & issue"}
                      </button>
                    </form>

                    <form action={extendCashHold}>
                      <input type="hidden" name="orderId" value={request.order.id} />
                      <input type="hidden" name="minutes" value="60" />
                      <button type="submit" className="btn btn-ghost w-full !min-h-9 !text-[0.8rem]">
                        Extend hold +1 h
                      </button>
                    </form>

                    <details className="rounded-xl border border-line bg-paper px-3 py-2">
                      <summary className="cursor-pointer text-xs font-bold text-bad">
                        Reject with reason
                      </summary>
                      <form action={rejectCashSale} className="mt-2 space-y-2">
                        <input type="hidden" name="orderId" value={request.order.id} />
                        <textarea
                          name="reason"
                          className="field !min-h-16 text-xs"
                          placeholder="Cash not handed over"
                          required
                        />
                        <button type="submit" className="btn btn-danger w-full !min-h-9 !text-xs">
                          Reject &amp; release seats
                        </button>
                      </form>
                    </details>
                  </div>
                </div>

                {isOwnSale ? (
                  <p className="border-t border-line bg-warn-soft/60 px-4 py-2 text-xs font-semibold text-warn">
                    You cannot approve a sale you took. Sign in on another owner account, or ask a
                    second owner.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 rounded-xl border border-line bg-paper/70 px-4 py-3 text-xs leading-relaxed text-muted">
        Approving mints a QR code for every seat, queues the ticket email, and records both names in
        the audit log. Rejecting releases the seats immediately and leaves the customer with
        nothing — hand the cash back first.
      </p>
    </StaffShell>
  );
}
