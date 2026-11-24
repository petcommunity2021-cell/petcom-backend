import Link from "next/link";
import { PublicFooter, PublicHeader, Wordmark } from "@/components/chrome";
import { optionalStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatPaise } from "@/lib/format";
import { publicEvents, tiersFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [session, events] = await Promise.all([optionalStaff(), publicEvents()]);

  const cards = await Promise.all(
    events.map(async (event) => {
      const tiers = await tiersFor(event.id);
      const cheapest = tiers.length > 0 ? Math.min(...tiers.map((t) => t.pricePaise)) : 0;
      return { event, cheapest, tierCount: tiers.length };
    }),
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader session={session} />

      <main className="flex-1">
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full opacity-30 blur-3xl"
            style={{ background: "var(--color-teal-soft)" }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -left-20 top-40 h-64 w-64 rounded-full opacity-40 blur-3xl"
            style={{ background: "var(--color-accent-soft)" }}
            aria-hidden
          />
          <div className="mx-auto w-full max-w-5xl px-4 pb-10 pt-14 sm:px-6 sm:pt-20">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-xs font-bold text-ink-soft">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
              Pet Community Events
            </p>
            <h1 className="max-w-2xl text-[2.1rem] font-bold leading-[1.1] sm:text-[3.1rem]">
              One ticket, one QR,
              <br />
              <span style={{ color: "var(--color-teal)" }}>and the dog walks in.</span>
            </h1>
            <p className="mt-4 max-w-xl text-[1.02rem] leading-relaxed text-ink-soft">
              Book online or at the counter. Your ticket arrives with a code the door can scan in
              a second — no lists, no screenshots, no arguments at the gate.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Link href="#events" className="btn btn-primary">
                See what&rsquo;s on
              </Link>
              {session ? (
                <Link href="/sell" className="btn btn-ghost">
                  Sell at the counter
                </Link>
              ) : (
                <Link href="/login" className="btn btn-ghost">
                  I&rsquo;m on the team
                </Link>
              )}
            </div>
          </div>
        </section>

        <section id="events" className="mx-auto w-full max-w-5xl scroll-mt-16 px-4 pb-6 sm:px-6">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 className="text-xl font-bold">Coming up</h2>
            <p className="text-xs text-muted">All times IST</p>
          </div>

          {cards.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-lg font-bold">No events are on sale yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
                Once an event is published it appears here automatically. If you are setting this
                up, run <code className="rounded bg-black/5 px-1.5 py-0.5">npm run db:seed</code>{" "}
                to load the demo event.
              </p>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {cards.map(({ event, cheapest, tierCount }) => (
                <li key={event.id}>
                  <Link
                    href={`/e/${event.slug}`}
                    className="card group flex h-full flex-col justify-between p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-lg font-bold leading-snug group-hover:text-teal">
                          {event.title}
                        </h3>
                        <span className="pill pill-teal shrink-0">
                          {event.status === "sold_out" ? "sold out" : "on sale"}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-ink-soft">
                        {formatIstDateTime(event.startsAt)}
                      </p>
                      <p className="text-sm text-muted">
                        {event.venueName || "Venue to be announced"}
                      </p>
                      {event.description ? (
                        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-soft">
                          {event.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-5 flex items-center justify-between border-t border-line pt-3">
                      <span className="text-sm font-semibold">
                        {tierCount > 0 ? (
                          <>
                            from{" "}
                            <span className="text-teal" style={{ color: "var(--color-teal)" }}>
                              {formatPaise(cheapest)}
                            </span>
                          </>
                        ) : (
                          "Pricing soon"
                        )}
                      </span>
                      <span className="text-sm font-bold text-ink-soft group-hover:text-teal">
                        Book →
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mx-auto mt-10 w-full max-w-5xl px-4 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Book in under a minute",
                body: "Pick a tier, pay by UPI or card, and the QR is on screen — and in your inbox.",
              },
              {
                title: "One code per person",
                body: "Every attendee gets their own code, so the door knows exactly who came in.",
              },
              {
                title: "Sold out means sold out",
                body: "Seats are held while you pay. Two people cannot buy the same last ticket.",
              },
            ].map((item) => (
              <div key={item.title} className="card p-5">
                <h3 className="text-sm font-bold">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
