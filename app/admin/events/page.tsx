import Link from "next/link";
import { setEventStatus } from "@/app/actions/events";
import { EventForm } from "@/components/event-form";
import { PageHead, StatusPill } from "@/components/chrome";
import { StaffShell } from "@/components/staff-shell";
import { requireStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatPaise } from "@/lib/format";
import { eventsOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Events" };

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; created?: string }>;
}) {
  const session = await requireStaff(["owner"]);
  const { ok, error, created } = await searchParams;
  const rows = await eventsOverview();

  return (
    <StaffShell session={session} active="/admin/events">
      <PageHead
        eyebrow="Catalogue"
        title="Events"
        sub="A draft is invisible. Publishing opens the page, the checkout and the scanner at once."
      />

      {ok ? (
        <p className="mt-4 rounded-xl border border-[#bfe0cc] bg-good-soft px-3 py-2.5 text-sm font-semibold text-good">
          {ok === "published" ? "Published. The page is live and tickets can be sold." : "Saved."}
        </p>
      ) : null}
      {created ? (
        <p className="mt-4 rounded-xl border border-[#bfe3dc] bg-teal-soft px-3 py-2.5 text-sm font-semibold text-teal-ink">
          Event #{created} saved as a draft. Publish it when the details are right.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-sm font-semibold text-bad">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
        <section className="space-y-3">
          {rows.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-lg font-bold">No events yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">
                Create one with the form beside this panel — or run the seed script for a demo
                event.
              </p>
            </div>
          ) : (
            rows.map(({ event, tiers, sold, revenue }) => {
              const pct = event.capacity > 0 ? Math.min(100, Math.round((sold / event.capacity) * 100)) : 0;
              const live = event.status === "on_sale";
              return (
                <article key={event.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill status={event.status} />
                        <span className="text-[0.7rem] text-muted">/{event.slug}</span>
                      </div>
                      <h2 className="mt-1.5 text-lg font-bold leading-snug">{event.title}</h2>
                      <p className="text-sm text-ink-soft">{formatIstDateTime(event.startsAt)}</p>
                      <p className="text-xs text-muted">{event.venueName || "No venue set"}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {live ? (
                        <Link href={`/e/${event.slug}`} className="btn btn-ghost !min-h-9 !text-xs">
                          View page
                        </Link>
                      ) : null}
                      <form action={setEventStatus}>
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="status" value={live ? "closed" : "on_sale"} />
                        <button
                          type="submit"
                          className={`btn !min-h-9 !text-xs ${live ? "btn-ghost" : "btn-primary"}`}
                        >
                          {live ? "Stop sales" : "Publish"}
                        </button>
                      </form>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-[0.66rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                        Sold
                      </p>
                      <p className="text-sm font-bold tabular-nums">
                        {sold}
                        <span className="font-normal text-muted"> / {event.capacity || "∞"}</span>
                      </p>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: "var(--color-teal)" }}
                        />
                      </div>
                    </div>
                    <div>
                      <p className="text-[0.66rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                        Collected
                      </p>
                      <p className="text-sm font-bold tabular-nums">{formatPaise(revenue)}</p>
                    </div>
                    <div>
                      <p className="text-[0.66rem] font-extrabold uppercase tracking-[0.1em] text-muted">
                        Tiers
                      </p>
                      <p className="text-sm font-bold tabular-nums">{tiers}</p>
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </section>

        <EventForm />
      </div>
    </StaffShell>
  );
}
