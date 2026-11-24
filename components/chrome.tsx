import Link from "next/link";
import type { Session } from "@/lib/auth/session";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  sales: "Sales",
  scanner: "Scanner",
};

export function Wordmark({ tone = "ink" }: { tone?: "ink" | "light" }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="display text-[1.35rem] font-bold leading-none"
        style={{ color: tone === "light" ? "#fff" : "var(--color-teal)" }}
      >
        petcom
      </span>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--color-accent)" }}
        aria-hidden
      />
    </span>
  );
}

export function PublicHeader({ session }: { session: Session | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-cream/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Petcom home">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-1.5 text-sm font-semibold">
          <Link href="/#events" className="hidden rounded-lg px-3 py-2 text-ink-soft hover:bg-black/5 sm:block">
            Events
          </Link>
          {session ? (
            <Link href="/admin" className="btn btn-ghost !min-h-9 !px-3 !text-[0.82rem]">
              {session.name.split(" ")[0]}&rsquo;s desk
            </Link>
          ) : (
            <Link href="/login" className="btn btn-ghost !min-h-9 !px-3 !text-[0.82rem]">
              Staff sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="mt-16 border-t border-line/80">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <Wordmark />
          <span>Pet Community Events</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/login" className="hover:underline">
            Staff sign in
          </Link>
          <Link href="/scan" className="hover:underline">
            Scanner
          </Link>
          <span>Tickets are non-transferable in v1.</span>
        </div>
      </div>
    </footer>
  );
}

export function PageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-accent">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-bold sm:text-[1.75rem]">{title}</h1>
        {sub ? <p className="mt-1 max-w-2xl text-sm text-ink-soft">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ink" | "teal" | "warn" | "bad" | "good";
}) {
  const colour =
    tone === "teal"
      ? "var(--color-teal)"
      : tone === "warn"
        ? "var(--color-warn)"
        : tone === "bad"
          ? "var(--color-bad)"
          : tone === "good"
            ? "var(--color-good)"
            : "var(--color-ink)";

  return (
    <div className="card p-4">
      <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums" style={{ color: colour }}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

const PILL: Record<string, string> = {
  paid: "pill-good",
  valid: "pill-good",
  approved: "pill-good",
  checked_in: "pill-teal",
  pending: "pill-warn",
  not_required: "pill-muted",
  draft: "pill-muted",
  scheduled: "pill-teal",
  on_sale: "pill-good",
  sold_out: "pill-warn",
  closed: "pill-muted",
  completed: "pill-muted",
  expired: "pill-muted",
  cancelled: "pill-bad",
  rejected: "pill-bad",
  refunded: "pill-bad",
  void: "pill-muted",
};

const LABEL: Record<string, string> = {
  checked_in: "checked in",
  not_required: "—",
  offline_cash: "cash",
  offline_upi: "UPI",
  offline_card: "card",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill ${PILL[status] ?? "pill-muted"}`}>
      {LABEL[status] ?? status.replaceAll("_", " ")}
    </span>
  );
}

export function ChannelPill({ channel }: { channel: string }) {
  const tone =
    channel === "online"
      ? "pill-teal"
      : channel === "offline_cash"
        ? "pill-warn"
        : channel === "comp"
          ? "pill-muted"
          : "pill-good";
  return <span className={`pill ${tone}`}>{LABEL[channel] ?? channel}</span>;
}

export function StaffBadge({ session }: { session: Session }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-teal-soft text-[0.7rem] font-extrabold text-teal-ink">
        {session.name.slice(0, 2).toUpperCase()}
      </span>
      <span className="hidden sm:inline">
        {session.name} · {ROLE_LABEL[session.role]}
      </span>
    </span>
  );
}
