import { PageHead } from "@/components/chrome";
import { StaffShell } from "@/components/staff-shell";
import { ScanConsole } from "./scan-console";
import { requireStaff } from "@/lib/auth/guard";
import { formatIstTime } from "@/lib/format";
import { latestScans } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Scanner" };

export default async function ScanPage() {
  const session = await requireStaff(["owner", "sales", "scanner"]);
  const recent = await latestScans(6);

  return (
    <StaffShell session={session} active="/scan">
      <PageHead
        eyebrow="Door"
        title="Scanner"
        sub="One scan per ticket, decided by a single atomic write. A second scan is refused, not argued with."
      />

      <div className="mt-5">
        <ScanConsole staffName={session.name} />
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
          Last through the gate
        </h2>
        {recent.length === 0 ? (
          <p className="mt-2 rounded-xl border border-line bg-paper px-4 py-3 text-sm text-muted">
            Nobody has been scanned yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
            {recent.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-semibold">{row.holderName || "Guest"}</span>
                <span className="text-xs text-muted">
                  {row.eventTitle} · {row.checkedInAt ? formatIstTime(row.checkedInAt) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </StaffShell>
  );
}
