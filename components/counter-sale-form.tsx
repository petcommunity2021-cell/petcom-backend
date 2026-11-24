"use client";

import { useActionState, useState } from "react";
import {
  sellAtCounter,
  type SellState,
} from "@/app/actions/counter";
import { formatPaise } from "@/lib/format";

export type SaleTier = {
  id: number;
  eventId: number;
  name: string;
  pricePaise: number;
  left: number;
  perOrderLimit: number;
};

export type SaleEvent = {
  id: number;
  title: string;
  startsAtLabel: string;
  tiers: SaleTier[];
};

const MODES = [
  {
    value: "upi",
    title: "UPI",
    hint: "Ticket issues now — the gateway confirms the money.",
    tone: "good",
  },
  {
    value: "card",
    title: "Card",
    hint: "Ticket issues now — the gateway confirms the money.",
    tone: "good",
  },
  {
    value: "cash",
    title: "Cash",
    hint: "No ticket yet. The owner approves it, then the QR is minted.",
    tone: "warn",
  },
  {
    value: "comp",
    title: "Comp / guest",
    hint: "No money taken. Still needs owner approval, still no ticket until then.",
    tone: "warn",
  },
] as const;

export function CounterSaleForm({ events }: { events: SaleEvent[] }) {
  const [state, formAction, pending] = useActionState<SellState, FormData>(
    sellAtCounter,
    { error: null },
  );

  const firstEvent = events.find((e) => e.tiers.some((t) => t.left > 0)) ?? events[0];
  const [eventId, setEventId] = useState(firstEvent?.id ?? 0);
  const event = events.find((e) => e.id === eventId) ?? firstEvent;
  const openTiers = event?.tiers.filter((t) => t.left > 0) ?? [];
  const [tierId, setTierId] = useState(openTiers[0]?.id ?? 0);
  const tier = event?.tiers.find((t) => t.id === tierId) ?? openTiers[0];
  const [quantity, setQuantity] = useState(1);
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("cash");

  const maxQuantity = Math.max(1, Math.min(tier?.left ?? 1, tier?.perOrderLimit ?? 1));
  const total = (tier?.pricePaise ?? 0) * quantity;
  const needsApproval = mode === "cash" || mode === "comp";

  if (!event) {
    return (
      <div className="card p-6 text-center">
        <p className="font-bold">No event is on sale</p>
        <p className="mt-1 text-sm text-ink-soft">
          Publish an event before selling at the counter.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="ticketTypeId" value={tier?.id ?? ""} />
      <input type="hidden" name="quantity" value={quantity} />
      <input type="hidden" name="mode" value={mode} />

      <section className="card p-5">
        <h2 className="text-lg font-bold">1 · What are they buying</h2>

        {events.length > 1 ? (
          <div className="mt-3">
            <label className="label" htmlFor="event-picker">
              Event
            </label>
            <select
              id="event-picker"
              className="field"
              value={event.id}
              onChange={(e) => {
                const next = events.find((x) => x.id === Number(e.target.value));
                setEventId(Number(e.target.value));
                const firstOpenTier = next?.tiers.find((t) => t.left > 0) ?? next?.tiers[0];
                setTierId(firstOpenTier?.id ?? 0);
                setQuantity(1);
              }}
            >
              {events.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.title} · {option.startsAtLabel}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">
            {event.title} · {event.startsAtLabel}
          </p>
        )}

        <fieldset className="mt-4 space-y-2">
          <legend className="label">Tier</legend>
          {event.tiers.map((option) => {
            const disabled = option.left === 0;
            const selected = option.id === tier?.id;
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 ${
                  disabled
                    ? "cursor-not-allowed border-line opacity-55"
                    : selected
                      ? "border-teal bg-teal-soft/50"
                      : "border-line bg-paper"
                }`}
                style={selected ? { borderColor: "var(--color-teal)" } : undefined}
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="tier-pick"
                    className="accent-teal"
                    checked={selected}
                    disabled={disabled}
                    onChange={() => {
                      setTierId(option.id);
                      setQuantity(1);
                    }}
                  />
                  <span className="text-sm font-bold">{option.name}</span>
                  <span className="text-xs text-muted">
                    {disabled ? "sold out" : `${option.left} left`}
                  </span>
                </span>
                <span className="text-sm font-bold tabular-nums">
                  {formatPaise(option.pricePaise)}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="mt-4">
          <span className="label">How many</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost !min-h-10 !w-10 !px-0"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="One fewer"
            >
              −
            </button>
            <span className="w-8 text-center text-lg font-bold tabular-nums">{quantity}</span>
            <button
              type="button"
              className="btn btn-ghost !min-h-10 !w-10 !px-0"
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              disabled={quantity >= maxQuantity}
              aria-label="One more"
            >
              +
            </button>
            <span className="ml-2 text-sm font-semibold tabular-nums text-ink-soft">
              = {formatPaise(total)}
            </span>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold">2 · Who is it for</h2>

        <div className="mt-3 grid gap-3">
          <div>
            <label className="label" htmlFor="sale-name">
              Name on ticket
            </label>
            <input id="sale-name" name="name" className="field" placeholder="Ravi Kumar" required />
          </div>
          <div>
            <label className="label" htmlFor="sale-phone">
              Mobile
            </label>
            <input
              id="sale-phone"
              name="phone"
              className="field"
              placeholder="98765 43210"
              inputMode="tel"
              required
            />
            <p className="mt-1 text-[0.7rem] text-muted">
              Required for cash — the owner may need to ring them if a request is rejected.
            </p>
          </div>
        </div>

        <h2 className="mt-5 text-lg font-bold">3 · How they are paying</h2>
        <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {MODES.map((option) => {
            const selected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={`rounded-xl border p-3 text-left transition ${
                  selected
                    ? option.tone === "good"
                      ? "border-[#bfe0cc] bg-good-soft"
                      : "border-[#ecd9a6] bg-warn-soft"
                    : "border-line bg-paper hover:border-muted/50"
                }`}
                aria-pressed={selected}
              >
                <span className="block text-sm font-bold">{option.title}</span>
                <span className="mt-0.5 block text-[0.72rem] leading-snug text-ink-soft">
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={`mt-4 rounded-xl border px-3 py-2.5 text-xs leading-relaxed ${
            needsApproval
              ? "border-[#ecd9a6] bg-warn-soft text-warn"
              : "border-[#bfe0cc] bg-good-soft text-good"
          }`}
        >
          {needsApproval ? (
            <>
              <strong>This will not issue a ticket.</strong> The seats are held for up to 2 hours
              (never past the event start) and the request lands on the owner&rsquo;s phone. The QR
              is created the moment they approve — by someone other than you.
            </>
          ) : (
            <>
              <strong>Ticket issues immediately.</strong> The money reaches the Petcom account, not
              your hands, so the gateway is the approval.
            </>
          )}
        </div>

        {state.error ? (
          <p className="mt-3 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-sm font-semibold text-bad">
            {state.error}
          </p>
        ) : null}

        <button type="submit" className="btn btn-primary mt-4 w-full" disabled={pending}>
          {pending
            ? "Sending…"
            : needsApproval
              ? `Request approval · ${formatPaise(total)}`
              : `Take ${formatPaise(total)} and issue`}
        </button>
      </section>
    </form>
  );
}
