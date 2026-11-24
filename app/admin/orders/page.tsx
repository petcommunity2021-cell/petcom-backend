import Link from "next/link";
import { ChannelPill, PageHead, Stat, StatusPill } from "@/components/chrome";
import { StaffShell } from "@/components/staff-shell";
import { requireStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatPaise } from "@/lib/format";
import { recentOrders } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireStaff(["owner"]);
  const { status } = await searchParams;

  const all = await recentOrders(200);
  const rows = status ? all.filter((row) => row.status === status) : all;

  const paid = all.filter((r) => r.status === "paid");
  const collected = paid.reduce((sum, row) => sum + row.totalPaise, 0);
  const pending = all.filter((r) => r.status === "pending" && r.approvalStatus !== "pending");
  const awaiting = all.filter((r) => r.approvalStatus === "pending");

  return (
    <StaffShell session={session} active="/admin/orders">
      <PageHead
        eyebrow="Money"
        title="Orders"
        sub="One row per purchase attempt — online, counter, cash or comp. Cash still pending has no ticket."
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Collected" value={formatPaise(collected)} hint={`${paid.length} paid orders`} tone="teal" />
        <Stat label="Awaiting approval" value={String(awaiting.length)} hint="cash & comps" tone={awaiting.length ? "warn" : "good"} />
        <Stat label="Open online holds" value={String(pending.length)} hint="10-minute holds" />
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {FILTERS.map((filter) => {
          const active = (status ?? "") === filter.value;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/admin/orders?status=${filter.value}` : "/admin/orders"}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                active ? "bg-teal-soft text-teal-ink" : "bg-paper text-ink-soft hover:bg-black/5"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>

      <section className="card mt-3 overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No orders match that filter.</p>
        ) : (
          <div className="tbl-scroll overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[0.66rem] uppercase tracking-[0.1em] text-muted">
                  <th className="px-4 py-2.5 font-extrabold">Order</th>
                  <th className="px-4 py-2.5 font-extrabold">Placed</th>
                  <th className="px-4 py-2.5 font-extrabold">Customer</th>
                  <th className="px-4 py-2.5 font-extrabold">Event</th>
                  <th className="px-4 py-2.5 font-extrabold">Channel</th>
                  <th className="px-4 py-2.5 font-extrabold">Seller</th>
                  <th className="px-4 py-2.5 text-right font-extrabold">Total</th>
                  <th className="px-4 py-2.5 font-extrabold">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((order) => (
                  <tr key={order.id} className="align-top">
                    <td className="px-4 py-2.5 font-mono text-xs">#{order.id}</td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {formatIstDateTime(order.createdAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block font-semibold">{order.customerName}</span>
                      <span className="block text-xs text-muted tabular-nums">
                        {order.customerPhone}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">{order.eventTitle}</td>
                    <td className="px-4 py-2.5">
                      <ChannelPill channel={order.channel} />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-soft">{order.soldByName ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {formatPaise(order.totalPaise)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex flex-wrap gap-1">
                        <StatusPill status={order.status} />
                        {order.approvalStatus === "pending" ? (
                          <span className="pill pill-warn">needs approval</span>
                        ) : null}
                        {order.approvalStatus === "rejected" ? (
                          <span className="pill pill-bad">rejected</span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {order.soldByName ? (
                        <Link
                          href={`/sell/order/${order.id}`}
                          className="text-xs font-bold underline"
                        >
                          Open
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-4 text-xs text-muted">
        Showing {rows.length} of {all.length} most recent orders.
      </p>
    </StaffShell>
  );
}
