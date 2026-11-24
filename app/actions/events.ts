"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { events, ticketTypes } from "@/lib/db/schema";
import { writeAudit } from "@/lib/domain/audit";
import { requireSession } from "@/lib/auth/session";

export type EventFormState = { error: string | null };


function slugify(title: string) {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/**
 * `datetime-local` gives us a wall-clock string with no zone. Petcom runs on
 * IST, so the zone is appended explicitly instead of trusting the server's
 * clock — a sale must not move because a VPS is in UTC.
 */
function istToUtc(value: string): Date | null {
  if (!value) return null;
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function createEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const session = await requireSession();
  if (session.role !== "owner") return { error: "Only the owner can create events." };

  const title = String(formData.get("title") ?? "").trim();
  const venueName = String(formData.get("venueName") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const startsAt = istToUtc(String(formData.get("startsAt") ?? ""));
  const capacity = Number(formData.get("capacity") ?? 0);
  const tierName = String(formData.get("tierName") ?? "").trim() || "General";
  const priceRupees = Number(formData.get("priceRupees") ?? 0);
  const tierQuantity = Number(formData.get("tierQuantity") ?? capacity);

  if (!title) return { error: "Give the event a name." };
  if (!startsAt) return { error: "Pick the date and time it starts." };
  if (!Number.isFinite(capacity) || capacity < 1) return { error: "Capacity must be at least 1." };
  if (!Number.isFinite(priceRupees) || priceRupees < 0) return { error: "Price cannot be negative." };
  if (!Number.isFinite(tierQuantity) || tierQuantity < 1) {
    return { error: "The first ticket tier needs at least one seat." };
  }

  const base = slugify(title) || "event";
  let slug = base;
  let suffix = 2;

  let eventId: number;
  try {
    eventId = await db.transaction(async (tx) => {
      // Slugs are the public URL. Retry with a suffix rather than failing the
      // owner's form on a collision.
      for (;;) {
        const [clash] = await tx.select({ id: events.id }).from(events).where(eq(events.slug, slug));
        if (!clash) break;
        slug = `${base}-${suffix++}`;
      }

      const [event] = await tx
        .insert(events)
        .values({
          slug,
          title,
          description,
          venueName,
          startsAt,
          capacity,
          status: "draft",
        })
        .returning();

      await tx.insert(ticketTypes).values({
        eventId: event.id,
        name: tierName,
        pricePaise: Math.round(priceRupees * 100),
        quantity: tierQuantity,
        perOrderLimit: Math.min(10, tierQuantity),
      });

      await writeAudit(tx, {
        staffId: session.staffId,
        action: "event.created",
        entity: "events",
        entityId: event.id,
        after: { slug, title, startsAt: startsAt.toISOString(), capacity },
      });

      return event.id;
    });
  } catch (error) {
    console.error("createEvent failed", error);
    return { error: "That event could not be saved. Try again." };
  }

  revalidatePath("/admin/events");
  revalidatePath("/");
  redirect(`/admin/events?created=${eventId}`);
}

/**
 * The one-click publish the plan asks for: from here the public page exists,
 * tickets can be sold and the scanner works.
 */
export async function setEventStatus(formData: FormData) {
  const session = await requireSession();
  if (session.role !== "owner") redirect("/admin/events?error=Only+the+owner+can+publish.");

  const eventId = Number(formData.get("eventId"));
  const next = String(formData.get("status") ?? "");

  if (!["draft", "on_sale", "closed", "cancelled", "completed"].includes(next)) {
    redirect("/admin/events?error=Unknown+status.");
  }

  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
      if (!before) throw new Error("not found");

      await tx
        .update(events)
        .set({
          status: next,
          publishedAt: next === "on_sale" ? before.publishedAt ?? new Date() : before.publishedAt,
          updatedAt: new Date(),
        })
        .where(eq(events.id, eventId));

      await writeAudit(tx, {
        staffId: session.staffId,
        action: next === "on_sale" ? "event.published" : "event.status_changed",
        entity: "events",
        entityId: eventId,
        before: { status: before.status },
        after: { status: next },
      });
    });
  } catch {
    redirect("/admin/events?error=That+change+did+not+save.");
  }

  revalidatePath("/admin/events");
  revalidatePath("/");
  redirect(`/admin/events?ok=${next === "on_sale" ? "published" : "updated"}`);
}
