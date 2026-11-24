import Link from "next/link";
import {
  ChannelPill,
  PageHead,
  Stat,
  StatusPill,
} from "@/components/chrome";
import { StaffShell } from "@/components/staff-shell";
import { requireStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatPaise, relativeFromNow } from "@/lib/format";
import { pendingApprovals } from "@/lib/domain/counter-sales";
import {
  cashToday,
  dashboardStats,
  recentOrders,
  unreadAlerts,
} from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Desk" };

export default async function AdminHome() {
  const session = await requireStaff(["owner"]);

  const [stats, approvals, alerts, orders, cash] = await Promise.all([
    dashboardStats(),
    pendingApprovals(),
    unreadAlerts(5),
    recentOrders(8),
    cashToday(),
  ]);

  const cashTotal = cash
    .filter((row) => row.channel === "offline_cash")
    .reduce((sum, row) => sum + row.totalPaise, 0);

  return (
    <StaffShell session={session} active="/admin">
      <PageHead
        eyebrow={`${formatIstDateTime(new Date())}`}
        title={`Good to see you, ${session.name.split(" ")[0]}`}
        sub="Everything on one screen: what sold, who is waiting, and what needs your signature."
        actions={
          <>
            <Link href="/sell" className="btn btn-ghost">
              Counter sale
            </Link>
            <Link href="/scan" className="btn btn-ghost">
              Scanner
            </Link>
          </>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Collected" value={formatPaise(stats.revenuePaise)} hint={`${stats.paidOrders} paid orders`} tone="teal" />
        <Stat label="Tickets sold" value={String(stats.ticketsSold)} hint={`${stats.admitted} admitted`} />
        <Stat
          label="Waiting on you"
          value={String(stats.waitingApprovals)}
          hint="cash sales, no ticket yet"
          tone={stats.waitingApprovals > 0 ? "warn" : "good"}
        />
        <Stat label="Cash at the counter" value={formatPaise(cashTotal)} hint="today, approved" />
      </div>

      {stats.waitingApprovals > 0 ? (
        <section className="mt-5 rounded-2xl border-2 border-[#ecd9a6] bg-warn-soft/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--color-warn)" }}>
                {stats.waitingApprovals} cash {stats.waitingApprovals === 1 ? "sale is" : "sales are"} waiting
              </p>
              <p className="text-xs text-ink-soft">
                Seats are held, no QR exists, and the customer is standing at the counter.
              </p>
            </div>
            <Link href="/admin/approvals" className="btn btn-accent">
              Review now
            </Link>
          </div>
        </section>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
              Waiting for approval
            </h2>
            <Link href="/admin/approvals" className="text-xs font-bold underline">
              All
            </Link>
          </div>
          {approvals.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">
              Nothing waiting. Every cash sale has been signed off.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {approvals.slice(0, 4).map(({ order, eventTitle, expiresAt }) => (
                <li key={order.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">
                      #{order.id} · {formatPaise(order.totalPaise)}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {eventTitle} · {relativeFromNow(order.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-warn">
                    {expiresAt
                      ? `expires ${new Date(expiresAt).toLocaleTimeString("en-IN", {
                          timeZone: "Asia/Kolkata",
                          hour: "numeric",
                          minute: "2-digit",
                        })}`
                      : "no deadline"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
              Alerts
            </h2>
          </div>
          {alerts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">Quiet. No unread alerts.</p>
          ) : (
            <ul className="divide-y divide-line">
              {alerts.map((alert) => (
                <li key={alert.id} className="px-4 py-3">
                  <p className="text-sm font-semibold">{alert.title}</p>
                  {alert.body ? <p className="text-xs text-muted">{alert.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
            Latest orders
          </h2>
          <Link href="/admin/orders" className="text-xs font-bold underline">
            All orders
          </Link>
        </div>
        {orders.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No orders yet.</p>
        ) : (
          <div className="tbl-scroll overflow-x-auto">
            <table className="w-full min-w-[340px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[0.68rem] uppercase tracking-[0.1em] text-muted">
                  <th className="px-4 py-2 font-extrabold">Order</th>
                  <th className="px-4 py-2 font-extrabold">Customer</th>
                  <th className="hidden px-4 py-2 font-extrabold sm:table-cell">Event</th>
                  <th className="hidden px-4 py-2 font-extrabold sm:table-cell">Channel</th>
                  <th className="px-4 py-2 text-right font-extrabold">Total</th>
                  <th className="px-4 py-2 font-extrabold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="px-4 py-2.5 font-mono text-xs">#{order.id}</td>
                    <td className="px-4 py-2.5">
                      <span className="block font-semibold">{order.customerName}</span>
                      <span className="block text-xs text-muted tabular-nums">
                        {order.customerPhone}
                      </span>
                    </td>
                    <td className="hidden px-4 py-2.5 text-ink-soft sm:table-cell">{order.eventTitle}</td>
                    <td className="hidden px-4 py-2.5 sm:table-cell">
                      <ChannelPill channel={order.channel} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {formatPaise(order.totalPaise)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        <StatusPill status={order.status} />
                        {order.approvalStatus === "pending" ? (
                          <span className="pill pill-warn !hidden sm:!inline-flex">needs approval</span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </StaffShell>
  );
}
