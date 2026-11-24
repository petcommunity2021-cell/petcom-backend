import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { PublicFooter, PublicHeader, StatusPill } from "@/components/chrome";
import { PrintButton } from "@/components/print-button";
import { optionalStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatIstTime, maskEmail, maskPhone } from "@/lib/format";
import { ticketByToken, ticketsForOrder } from "@/lib/queries";

export const dynamic = "force-dynamic";

function baseUrl() {
  return process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
}

export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await optionalStaff();
  const found = await ticketByToken(token);
  if (!found) notFound();

  const { ticket, event, tierName, holderEmail, order } = found;
  const url = `${baseUrl().replace(/\/$/, "")}/ticket/${token}`;
  const qrSvg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 260,
    errorCorrectionLevel: "M",
    color: { dark: "#12211f", light: "#ffffff" },
  });

  const siblings = (await ticketsForOrder(order.id)).filter(
    (t) => t.qrToken && t.qrToken !== token,
  );

  const admitted = ticket.status === "checked_in";

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader session={session} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {admitted ? (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#bfe3dc] bg-teal-soft px-4 py-3">
            <span aria-hidden className="text-lg">
              ✓
            </span>
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--color-teal-ink)" }}>
                This ticket has already been scanned
              </p>
              <p className="text-xs text-ink-soft">
                Admitted at {ticket.checkedInAt ? formatIstTime(ticket.checkedInAt) : "the gate"}.
                A second scan will be refused.
              </p>
            </div>
          </div>
        ) : null}

        <article className="card overflow-hidden">
          <header
            className="px-5 py-5 text-white"
            style={{ background: "linear-gradient(135deg,#0f766e,#0b3f3a)" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.16em] text-white/70">
                  Petcom ticket
                </p>
                <h1 className="mt-1 text-xl font-bold leading-snug sm:text-2xl">{event.title}</h1>
                <p className="mt-1 text-sm text-white/85">{formatIstDateTime(event.startsAt)}</p>
                <p className="text-sm text-white/70">{event.venueName || "Venue to be announced"}</p>
              </div>
              <StatusPill status={ticket.status} />
            </div>
          </header>

          <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="mx-auto rounded-xl border border-line bg-white p-2.5">
              <div
                className="h-[260px] w-[260px] [&>svg]:h-full [&>svg]:w-full"
                // Server-rendered SVG from our own token — no user HTML reaches this.
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            </div>

            <dl className="space-y-2.5 text-sm">
              <div>
                <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                  Attendee
                </dt>
                <dd className="text-base font-bold">{ticket.holderName || "Guest"}</dd>
              </div>
              <div>
                <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                  Ticket
                </dt>
                <dd className="font-semibold">{tierName}</dd>
              </div>
              <div>
                <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                  Phone
                </dt>
                <dd className="font-semibold tabular-nums">{maskPhone(ticket.holderPhone)}</dd>
              </div>
              <div>
                <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                  Email
                </dt>
                <dd className="font-semibold">{maskEmail(holderEmail)}</dd>
              </div>
              <div>
                <dt className="text-[0.68rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                  Code
                </dt>
                <dd className="break-all font-mono text-xs text-ink-soft">{token}</dd>
              </div>
            </dl>
          </div>

          <footer className="border-t border-line bg-cream/60 px-5 py-4">
            <p className="text-xs leading-relaxed text-muted">
              Show this at the gate. One scan per ticket. Screenshots work, but the code is
              single-use — do not post it publicly.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <PrintButton />
              <Link href="/" className="btn btn-ghost">
                Petcom home
              </Link>
            </div>
          </footer>
        </article>

        {siblings.length > 0 ? (
          <section className="mt-5">
            <h2 className="text-sm font-extrabold uppercase tracking-[0.1em] text-muted">
              Also in this order
            </h2>
            <ul className="mt-2 grid gap-2">
              {siblings.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/ticket/${t.qrToken}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-paper px-4 py-3 text-sm hover:border-muted/60"
                  >
                    <span className="font-semibold">{t.holderName || "Guest"}</span>
                    <span className="text-muted">
                      {t.status === "checked_in" ? "used" : "open ticket"} →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      <PublicFooter />
    </div>
  );
}
