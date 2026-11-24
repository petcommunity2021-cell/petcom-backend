import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema";

export type CheckInOutcome =
  | {
      result: "admitted";
      ticketId: number;
      holderName: string;
      checkedInAt: Date;
    }
  | {
      result: "already_used";
      holderName: string;
      checkedInAt: Date | null;
      device: string | null;
    }
  | { result: "void" | "cancelled" | "refund_requested"; holderName: string }
  | { result: "not_found" };

/**
 * One atomic statement decides the door. Everything else is explanation.
 *
 * `UPDATE … WHERE status = 'valid' RETURNING` means two scanners holding the
 * same QR cannot both win: the second updates zero rows because the first
 * already changed the status. No read-then-write, no lock ordering, no race.
 */
export async function checkIn(
  qrToken: string,
  staffId: number | null,
  device: string | null,
): Promise<CheckInOutcome> {
  const token = normaliseToken(qrToken);
  if (!token) return { result: "not_found" };

  const updated = await db
    .update(tickets)
    .set({
      status: "checked_in",
      checkedInAt: sql`now()`,
      checkedInBy: staffId,
      checkInDevice: device,
    })
    .where(sql`${tickets.qrToken} = ${token} and ${tickets.status} = 'valid'`)
    .returning();

  if (updated.length > 0) {
    const t = updated[0];
    return {
      result: "admitted",
      ticketId: t.id,
      holderName: t.holderName,
      checkedInAt: t.checkedInAt ?? new Date(),
    };
  }

  const [existing] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.qrToken, token))
    .limit(1);

  if (!existing) return { result: "not_found" };

  if (existing.status === "checked_in") {
    return {
      result: "already_used",
      holderName: existing.holderName,
      checkedInAt: existing.checkedInAt,
      device: existing.checkInDevice,
    };
  }

  if (existing.status === "void") return { result: "void", holderName: existing.holderName };
  if (existing.status === "cancelled") {
    return { result: "cancelled", holderName: existing.holderName };
  }
  return { result: "refund_requested", holderName: existing.holderName };
}

/**
 * Staff paste a whole ticket URL as often as they paste a bare token, and the
 * QR itself encodes the URL, so accept both.
 */
export function normaliseToken(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const match = value.match(/\/ticket\/([A-Za-z0-9_-]+)/);
  if (match) return match[1];
  return value;
}

export async function recentScans(limit = 5) {
  return db
    .select({
      id: tickets.id,
      holderName: tickets.holderName,
      checkedInAt: tickets.checkedInAt,
      device: tickets.checkInDevice,
    })
    .from(tickets)
    .where(sql`${tickets.status} = 'checked_in'`)
    .orderBy(sql`${tickets.checkedInAt} desc nulls last`)
    .limit(limit);
}
