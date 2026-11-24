import Link from "next/link";
import { signOut } from "@/lib/auth/actions";
import type { Session } from "@/lib/auth/session";
import { StaffBadge, Wordmark } from "@/components/chrome";

type NavItem = { href: string; label: string; roles: Session["role"][] };

const NAV: NavItem[] = [
  { href: "/admin", label: "Desk", roles: ["owner"] },
  { href: "/admin/approvals", label: "Approvals", roles: ["owner"] },
  { href: "/admin/orders", label: "Orders", roles: ["owner"] },
  { href: "/admin/events", label: "Events", roles: ["owner"] },
  { href: "/sell", label: "Sell", roles: ["owner", "sales"] },
  { href: "/scan", label: "Scanner", roles: ["owner", "sales", "scanner"] },
];

export function StaffShell({
  session,
  active,
  children,
}: {
  session: Session;
  active?: string;
  children: React.ReactNode;
}) {
  const items = NAV.filter((item) => item.roles.includes(session.role));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-2.5 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <Link href={session.role === "owner" ? "/admin" : "/scan"} className="flex items-center gap-2">
              <Wordmark />
              <span className="hidden text-[0.7rem] font-bold uppercase tracking-[0.12em] text-muted sm:inline">
                {session.role === "scanner" ? "door" : "team desk"}
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <StaffBadge session={session} />
              <form action={signOut}>
                <button type="submit" className="text-xs font-bold text-muted underline">
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <nav className="-mx-1 flex flex-wrap gap-1 pb-0.5 text-sm font-bold">
            {items.map((item) => {
              const isActive = active === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-lg px-3 py-1.5 transition ${
                    isActive
                      ? "bg-teal-soft text-teal-ink"
                      : "text-ink-soft hover:bg-black/5"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-7">{children}</main>

      <footer className="border-t border-line/70 py-4 text-center text-[0.7rem] text-muted">
        Petcom v1 · money in paise, times in IST · every admin write lands in the audit log
      </footer>
    </div>
  );
}
