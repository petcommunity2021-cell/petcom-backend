"use client";

import { useActionState, useState } from "react";
import {
  startCheckout,
  type CheckoutState,
} from "@/app/actions/checkout";
import { formatPaise } from "@/lib/format";

export type TierOption = {
  id: number;
  name: string;
  pricePaise: number;
  left: number;
  perOrderLimit: number;
  includesPet: boolean;
};

export function CheckoutForm({
  eventId,
  tiers,
}: {
  eventId: number;
  tiers: TierOption[];
}) {
  const [state, formAction, pending] = useActionState<CheckoutState, FormData>(
    startCheckout,
    { error: null },
  );

  const firstOpen = tiers.find((t) => t.left > 0) ?? tiers[0];
  const [tierId, setTierId] = useState<number>(firstOpen?.id ?? 0);
  const [quantity, setQuantity] = useState(1);

  const tier = tiers.find((t) => t.id === tierId) ?? firstOpen;
  const maxQuantity = Math.max(1, Math.min(tier?.left ?? 1, tier?.perOrderLimit ?? 1));
  const total = (tier?.pricePaise ?? 0) * quantity;
  const soldOut = !tier || tier.left === 0;

  return (
    <form action={formAction} className="card p-5 sm:p-6" id="book">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="ticketTypeId" value={tier?.id ?? ""} />
      <input type="hidden" name="quantity" value={quantity} />

      <h2 className="text-lg font-bold">Choose your tickets</h2>

      <fieldset className="mt-4 space-y-2.5">
        <legend className="sr-only">Ticket type</legend>
        {tiers.map((option) => {
          const disabled = option.left === 0;
          const selected = option.id === tierId;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3.5 transition ${
                disabled
                  ? "cursor-not-allowed border-line bg-black/[0.02] opacity-60"
                  : selected
                    ? "border-teal bg-teal-soft/50"
                    : "border-line bg-paper hover:border-muted/50"
              }`}
              style={selected ? { borderColor: "var(--color-teal)" } : undefined}
            >
              <span className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="tier-pick"
                  className="mt-1 accent-teal"
                  checked={selected}
                  disabled={disabled}
                  onChange={() => {
                    setTierId(option.id);
                    setQuantity(1);
                  }}
                />
                <span>
                  <span className="block text-sm font-bold">{option.name}</span>
                  <span className="block text-xs text-muted">
                    {disabled
                      ? "Sold out"
                      : option.includesPet
                        ? "Includes one pet · " + option.left + " left"
                        : option.left + " left"}
                  </span>
                </span>
              </span>
              <span className="text-sm font-bold tabular-nums">{formatPaise(option.pricePaise)}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <span className="label">How many</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost !min-h-10 !w-10 !px-0"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="One fewer ticket"
            >
              −
            </button>
            <span className="w-8 text-center text-lg font-bold tabular-nums">{quantity}</span>
            <button
              type="button"
              className="btn btn-ghost !min-h-10 !w-10 !px-0"
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              disabled={quantity >= maxQuantity}
              aria-label="One more ticket"
            >
              +
            </button>
          </div>
        </div>
        <div className="text-right">
          <span className="label !mb-0">Total</span>
          <p className="text-xl font-bold tabular-nums">{formatPaise(total)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="name">
            Name on ticket
          </label>
          <input id="name" name="name" className="field" placeholder="Asha Rao" required />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Mobile
          </label>
          <input
            id="phone"
            name="phone"
            className="field"
            placeholder="98765 43210"
            inputMode="tel"
            autoComplete="tel"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="email">
            Email for the ticket
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="field"
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-xs leading-relaxed text-ink-soft">
        <input type="checkbox" name="consent" className="mt-0.5 accent-teal" />
        <span>
          Send me the occasional Petcom event announcement. Transactional messages about this
          booking are sent regardless.
        </span>
      </label>

      {state.error ? (
        <p className="mt-4 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-sm font-semibold text-bad">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary mt-5 w-full" disabled={pending || soldOut}>
        {soldOut ? "Sold out" : pending ? "Holding your seats…" : `Hold seats · ${formatPaise(total)}`}
      </button>
      <p className="mt-2 text-center text-[0.7rem] text-muted">
        Seats are held for 10 minutes while you pay. Nothing is charged yet.
      </p>
    </form>
  );
}
