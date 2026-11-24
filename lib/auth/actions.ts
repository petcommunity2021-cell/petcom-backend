"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db/client";
import { authSessions, otpCodes, staff } from "@/lib/db/schema";
import { buildSession, clearSessionCookie, getSession, setSessionCookie } from "@/lib/auth/session";

export type LoginState = { stage: "email" | "code"; message: string; email?: string };

const CODE_TTL_MINUTES = 10;

function sixDigits(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * No mail provider in v1. The code is written to the server console and to the
 * `otp_codes` table, so the owner can log in on localhost without SMTP — and
 * swapping in Resend later is one `sendEmail()` call.
 */
export async function requestCode(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) {
    return { stage: "email", message: "Enter a valid email address." };
  }

  const [member] = await db
    .select()
    .from(staff)
    .where(and(eq(staff.email, email), eq(staff.active, true)))
    .limit(1);

  // Same response whether or not the account exists — no account enumeration.
  if (member) {
    const code = sixDigits();
    await db.insert(otpCodes).values({
      email,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    });

    console.log(
      [
        "",
        "  ┌──────────────────────────────────────────────┐",
        `  │  Petcom login code for ${email.padEnd(20)}│`,
        `  │                                              │`,
        `  │            ${code}                          │`,
        "  │                                              │",
        "  └──────────────────────────────────────────────┘",
        "",
      ].join("\n"),
    );
  }

  return {
    stage: "code",
    email,
    message: "If that address is on the team, a code was printed to the server console.",
  };
}

export async function verifyCode(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();

  const [row] = await db
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.email, email), isNull(otpCodes.consumedAt)))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  if (!row || row.expiresAt.getTime() < Date.now()) {
    return { stage: "code", email, message: "That code has expired. Request a new one." };
  }

  const a = Buffer.from(row.code);
  const b = Buffer.from(code);
  const matches = a.length === b.length && timingSafeEqual(a, b);

  if (!matches) {
    return { stage: "code", email, message: "That code is not right." };
  }

  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(eq(otpCodes.id, row.id));

  const [member] = await db
    .select()
    .from(staff)
    .where(and(eq(staff.email, email), eq(staff.active, true)))
    .limit(1);

  if (!member) {
    return { stage: "email", message: "That account is no longer active." };
  }

  await db.insert(authSessions).values({
    staffId: member.id,
    expiresAt: new Date(Date.now() + 2 * 864e5),
  });

  await setSessionCookie(
    buildSession({
      staffId: member.id,
      name: member.name,
      email: member.email,
      role: member.role as "owner" | "sales" | "scanner",
    }),
  );

  redirect(member.role === "scanner" ? "/scan" : "/admin");
}

export async function signOut() {
  const session = await getSession();
  if (session) {
    await db.delete(authSessions).where(eq(authSessions.staffId, session.staffId));
  }
  await clearSessionCookie();
  redirect("/login");
}
