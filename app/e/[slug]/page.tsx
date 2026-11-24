import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckoutForm, type TierOption } from "@/components/checkout-form";
import { PublicFooter, PublicHeader, StatusPill } from "@/components/chrome";
import { optionalStaff } from "@/lib/auth/guard";
import { formatIstDateTime, formatIstTime, formatPaise } from "@/lib/format";
import { availabilityFor } from "@/lib/domain/inventory";
import { eventBySlug, tiersFor } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [session, event] = await Promise.all([optionalStaff(), eventBySlug(slug)]);

  if (!event) notFound();

  const [tiers, availability] = await Promise.all([
    tiersFor(event.id),
    availabilityFor(event.id),
  ]);

  const left = new Map(availability.map((a) => [a.tierId, a.left]));
  const options: TierOption[] = tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    pricePaise: tier.pricePaise,
    left: left.get(tier.id) ?? tier.quantity,
    perOrderLimit: tier.perOrderLimit,
    includesPet: tier.includesPet,
  }));

  const open = options.some((o) => o.left > 0);
  const sellable = event.status === "on_sale" || event.status === "scheduled";
  const totalLeft = options.reduce((sum, option) => sum + option.left, 0);

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader session={session} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <nav className="mb-5 text-sm text-muted">
          <Link href="/" className="hover:underline">
            ← All events
          </Link>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={event.status} />
              {totalLeft > 0 && totalLeft <= 10 ? (
                <span className="pill pill-warn">{totalLeft} left</span>
              ) : null}
            </div>

            <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-[2.6rem]">{event.title}</h1>

            <dl className="mt-5 space-y-2.5 text-sm">
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">When</dt>
                <dd className="font-semibold">
                  {formatIstDateTime(event.startsAt)}
                  {event.endsAt ? ` – ${formatIstTime(event.endsAt)}` : ""}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">Where</dt>
                <dd className="font-semibold">
                  {event.venueName || "To be announced"}
                  {event.venueMapUrl ? (
                    <>
                      {" · "}
                      <a
                        href={event.venueMapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-bold underline decoration-dotted"
                      >
                        Map
                      </a>
                    </>
                  ) : null}
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-20 shrink-0 text-muted">Capacity</dt>
                <dd className="font-semibold">{event.capacity > 0 ? `${event.capacity} seats` : "Open"}</dd>
              </div>
            </dl>

            {event.description ? (
              <div className="mt-6 border-t border-line pt-6">
                <p className="whitespace-pre-line text-[0.97rem] leading-relaxed text-ink-soft">
                  {event.description}
                </p>
              </div>
            ) : null}

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { title: "One QR per attendee", body: "Nobody shares a code through the gate." },
                { title: "Refunds on cancellation", body: "If we cancel, you are refunded in full." },
                { title: "Pets welcome", body: "Where the venue allows, bring the whole family." },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-line bg-paper p-3.5">
                  <p className="text-xs font-bold">{item.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            {!sellable || !open ? (
              <div className="card p-6 text-center">
                <p className="text-lg font-bold">
                  {!sellable ? "Not on sale yet" : "Every ticket has gone"}
                </p>
                <p className="mt-1.5 text-sm text-ink-soft">
                  {!sellable
                    ? "This page will open for booking once sales start."
                    : "This event sold out. Ask about the waitlist at the counter."}
                </p>
                <Link href="/" className="btn btn-ghost mt-4 w-full">
                  See other events
                </Link>
              </div>
            ) : (
              <CheckoutForm eventId={event.id} tiers={options} />
            )}

            {options.length > 0 ? (
              <div className="mt-3 rounded-xl border border-line bg-paper/60 px-4 py-3 text-xs text-muted">
                Prices include entry for one adult
                {options.some((o) => o.includesPet) ? " (pet tiers noted above)" : ""}. Paid online by
                UPI or card.
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-line bg-paper/60 px-4 py-3 text-xs text-muted">
              Buying at the gate? A UPI or card sale issues the ticket instantly.{" "}
              {options.length > 0
                ? `Cheapest tier is ${formatPaise(Math.min(...options.map((o) => o.pricePaise)))}.`
                : ""}
            </div>
          </div>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
