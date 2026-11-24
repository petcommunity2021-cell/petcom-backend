import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Countdown } from "@/components/countdown";
import { ChannelPill, PageHead, StatusPill } from "@/components/chrome";
import { StaffShell } from "@/components/staff-shell";
import { requireStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatPaise } from "@/lib/format";
import { orderSummary, ticketsForOrder } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function CounterOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaff(["owner", "sales"]);
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isFinite(orderId)) notFound();

  const summary = await orderSummary(orderId);
  if (!summary) notFound();

  const tickets = await ticketsForOrder(orderId);
  const issued = tickets.filter((t) => t.qrToken && t.status === "valid");
  const waiting = summary.order.approvalStatus === "pending" && summary.order.status === "pending";
  const rejected = summary.order.approvalStatus === "rejected";
  const expired = summary.order.approvalStatus === "expired" || summary.order.status === "expired";

  return (
    <StaffShell session={session} active="/sell">
      {waiting ? <AutoRefresh /> : null}
      <PageHead
        eyebrow={`Order #${summary.order.id}`}
        title={
          issued.length > 0
            ? "Tickets issued"
            : waiting
              ? "Waiting for the owner"
              : rejected
                ? "Request rejected"
                : expired
                  ? "Request expired"
                  : "Order status"
        }
        sub={`${summary.eventTitle} · ${formatIstDateTime(summary.startsAt)}`}
        actions={
          <Link href="/sell" className="btn btn-ghost">
            New sale
          </Link>
        }
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={summary.order.status} />
            <ChannelPill channel={summary.order.channel} />
            {summary.order.approvalStatus !== "not_required" ? (
              <span className="pill pill-muted">approval: {summary.order.approvalStatus}</span>
            ) : null}
          </div>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Customer</dt>
              <dd className="font-semibold">{summary.customerName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Mobile</dt>
              <dd className="font-semibold tabular-nums">{summary.customerPhone}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Tickets</dt>
              <dd className="font-semibold tabular-nums">{tickets.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Taken by</dt>
              <dd className="font-semibold">{summary.soldByName ?? "—"}</dd>
            </div>
            {summary.approvedByName ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Approved by</dt>
                <dd className="font-semibold">{summary.approvedByName}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4 border-t border-line pt-2 text-base">
              <dt className="font-bold">Total</dt>
              <dd className="font-bold tabular-nums">{formatPaise(summary.order.totalPaise)}</dd>
            </div>
          </dl>

          {waiting && summary.order.approvalExpiresAt ? (
            <p className="mt-4 rounded-xl border border-[#ecd9a6] bg-warn-soft px-3 py-2.5 text-sm font-semibold text-warn">
              <Countdown to={summary.order.approvalExpiresAt.toISOString()} prefix="Seats held for" />
              {" · then they go back on sale."}
            </p>
          ) : null}
        </section>

        <section className="card p-5">
          {issued.length > 0 ? (
            <>
              <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
                Hand these to the customer
              </h2>
              <ul className="mt-3 space-y-2">
                {issued.map((ticket) => (
                  <li key={ticket.id}>
                    <Link
                      href={`/ticket/${ticket.qrToken}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-sm hover:border-muted/60"
                    >
                      <span>
                        <span className="block font-bold">{ticket.holderName || "Guest"}</span>
                        <span className="block text-xs text-muted">show the QR</span>
                      </span>
                      <span className="font-bold text-ink-soft">Open →</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                The same tickets were queued for email. Opening one lets you print or show it
                straight away.
              </p>
            </>
          ) : waiting ? (
            <>
              <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
                Why there is no ticket
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                You took cash, so a person has to confirm it reached Petcom. Until the owner
                approves, these seats are held but <strong>no QR code exists anywhere</strong> —
                not on this screen, not in the customer&rsquo;s inbox.
              </p>
              <ul className="mt-3 space-y-1.5 text-xs text-muted">
                <li>• The owner sees this in Approvals with your name and the amount.</li>
                <li>• You cannot approve it yourself — that is enforced by the server.</li>
                <li>• If it is rejected or expires, the seats are released automatically.</li>
              </ul>
              {session.role === "owner" ? (
                <Link href="/admin/approvals" className="btn btn-ghost mt-4 w-full">
                  Open the approvals queue
                </Link>
              ) : (
                <p className="mt-3 text-xs text-muted">
                  The request is already on the owner&rsquo;s phone. You will see the tickets here
                  once it is approved — keep this page open.
                </p>
              )}
            </>
          ) : rejected ? (
            <>
              <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
                Rejected
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {summary.order.rejectionReason || "No reason was recorded."}
              </p>
              <p className="mt-3 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-xs font-semibold text-bad">
                The seats are back on sale, and the customer has no ticket. If you already took the
                cash, hand it back now.
              </p>
            </>
          ) : expired ? (
            <>
              <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
                Expired
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                Nobody approved this in time, so the hold lapsed and the seats returned to
                inventory. Start a fresh sale if they are still standing there.
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-soft">This order has no tickets to show.</p>
          )}
        </section>
      </div>
    </StaffShell>
  );
}
