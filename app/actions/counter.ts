"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import {
  approveSale,
  createCounterSale,
  extendHold,
  rejectSale,
  type CounterMode,
} from "@/lib/domain/counter-sales";
import { DomainError } from "@/lib/domain/errors";
import { normalisePhone } from "@/lib/format";

export type SellState = { error: string | null };


const MODES: CounterMode[] = ["cash", "upi", "card", "comp"];

/**
 * A counter sale. The role check happens here even though `/sell` already
 * gates the page — a server action is a public endpoint with a form attached.
 */
export async function sellAtCounter(
  _prev: SellState,
  formData: FormData,
): Promise<SellState> {
  const session = await requireSession();
  if (session.role === "scanner") {
    return { error: "Scanner accounts cannot sell tickets." };
  }

  const eventId = Number(formData.get("eventId"));
  const ticketTypeId = Number(formData.get("ticketTypeId"));
  const quantity = Number(formData.get("quantity"));
  const mode = String(formData.get("mode") ?? "cash") as CounterMode;
  const holderName = String(formData.get("name") ?? "").trim();

  if (!MODES.includes(mode)) return { error: "Pick a payment mode." };
  if (!holderName) return { error: "Whose name goes on the ticket?" };

  let phone: string;
  try {
    phone = normalisePhone(String(formData.get("phone") ?? ""));
  } catch (error) {
    // Cash goes to an approval queue, so the owner must be able to ring them back.
    return { error: (error as Error).message };
  }

  let result: Awaited<ReturnType<typeof createCounterSale>>;
  try {
    result = await createCounterSale({
      staffId: session.staffId,
      eventId,
      ticketTypeId,
      quantity,
      mode,
      holderName,
      holderPhone: phone,
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    console.error("counter sale failed", error);
    return { error: "The sale did not go through. Try again." };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/approvals");
  revalidatePath("/admin/orders");

  // One page handles both outcomes: issued tickets, or a request waiting on
  // the owner. The seller never sees a printable ticket for unapproved cash.
  redirect(`/sell/order/${result.orderId}`);
}

function backTo(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  redirect(`${path}?${query}`);
}

export async function approveCashSale(formData: FormData) {
  const session = await requireSession();
  const orderId = Number(formData.get("orderId"));

  try {
    await approveSale(orderId, { staffId: session.staffId, role: session.role });
  } catch (error) {
    if (error instanceof DomainError) {
      backTo("/admin/approvals", { error: error.message });
    }
    throw error;
  }

  revalidatePath("/admin/approvals");
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  backTo("/admin/approvals", { ok: `Order #${orderId} approved — QR codes minted.` });
}

export async function rejectCashSale(formData: FormData) {
  const session = await requireSession();
  const orderId = Number(formData.get("orderId"));
  const reason = String(formData.get("reason") ?? "");

  try {
    await rejectSale(orderId, { staffId: session.staffId, role: session.role }, reason);
  } catch (error) {
    if (error instanceof DomainError) {
      backTo("/admin/approvals", { error: error.message });
    }
    throw error;
  }

  revalidatePath("/admin/approvals");
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  backTo("/admin/approvals", { ok: `Order #${orderId} rejected. Seats released.` });
}

export async function extendCashHold(formData: FormData) {
  const session = await requireSession();
  const orderId = Number(formData.get("orderId"));
  const minutes = Number(formData.get("minutes") ?? 60);

  try {
    await extendHold(orderId, { staffId: session.staffId, role: session.role }, minutes);
  } catch (error) {
    if (error instanceof DomainError) {
      backTo("/admin/approvals", { error: error.message });
    }
    throw error;
  }

  revalidatePath("/admin/approvals");
  backTo("/admin/approvals", { ok: `Hold on order #${orderId} extended by ${minutes} minutes.` });
}
