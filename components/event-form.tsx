"use client";

import { useActionState } from "react";
import {
  createEvent,
  type EventFormState,
} from "@/app/actions/events";

export function EventForm() {
  const [state, formAction, pending] = useActionState<EventFormState, FormData>(
    createEvent,
    { error: null },
  );

  return (
    <form action={formAction} className="card p-5">
      <h2 className="text-lg font-bold">New event</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Saved as a draft first. Publishing is a separate click, so nothing goes live by accident.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="title">
            Event name
          </label>
          <input id="title" name="title" className="field" placeholder="Holi with Pets" required />
        </div>

        <div>
          <label className="label" htmlFor="startsAt">
            Starts (IST)
          </label>
          <input id="startsAt" name="startsAt" type="datetime-local" className="field" required />
        </div>

        <div>
          <label className="label" htmlFor="endsAt">Ends (IST)</label>
          <input id="endsAt" name="endsAt" type="datetime-local" className="field" />
        </div>

        <div>
          <label className="label" htmlFor="venueName">
            Venue
          </label>
          <input id="venueName" name="venueName" className="field" placeholder="Cubbon Park" />
        </div>

        <div>
          <label className="label" htmlFor="capacity">
            Total seats
          </label>
          <input
            id="capacity"
            name="capacity"
            type="number"
            min={1}
            defaultValue={50}
            className="field"
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="description">
            Short description
          </label>
          <input
            id="description"
            name="description"
            className="field"
            placeholder="An afternoon of…"
          />
        </div>

        <div className="sm:col-span-2 mt-1 border-t border-line pt-3">
          <p className="text-[0.7rem] font-extrabold uppercase tracking-[0.1em] text-muted">
            First ticket tier
          </p>
        </div>

        <div>
          <label className="label" htmlFor="tierName">
            Tier name
          </label>
          <input id="tierName" name="tierName" className="field" placeholder="General" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="priceRupees">
              Price ₹
            </label>
            <input
              id="priceRupees"
              name="priceRupees"
              type="number"
              min={0}
              step={1}
              defaultValue={499}
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="tierQuantity">
              Seats
            </label>
            <input
              id="tierQuantity"
              name="tierQuantity"
              type="number"
              min={1}
              defaultValue={50}
              className="field"
            />
          </div>
        </div>
        {[2, 3].map((index) => (
          <fieldset key={index} className="grid grid-cols-2 gap-3 border-t border-line pt-3 sm:col-span-2">
            <legend className="text-xs font-bold">Ticket tier {index} (optional)</legend>
            <label className="label col-span-2">
              Tier name
              <input name={`tierName${index}`} className="field" />
            </label>
            <label className="label">
              Price ₹
              <input name={`priceRupees${index}`} className="field" type="number" min={0} step={1} />
            </label>
            <label className="label">
              Seats
              <input name={`tierQuantity${index}`} className="field" type="number" min={1} />
            </label>
          </fieldset>
        ))}
      </div>

      {state.error ? (
        <p className="mt-4 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-sm font-semibold text-bad">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary mt-4" disabled={pending}>
        {pending ? "Saving…" : "Save draft"}
      </button>
    </form>
  );
}
