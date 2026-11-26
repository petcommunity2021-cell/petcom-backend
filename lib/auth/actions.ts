"use server";

import { scrypt, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { staff } from "@/lib/db/schema";
import { buildSession, clearSessionCookie, setSessionCookie } from "@/lib/auth/session";

export type LoginState = { message: string };

const accounts = {
  "Owner@12": ["owner@petcom.in", "STAFF_OWNER_PASSWORD_HASH"],
  "Sales@34": ["seller@petcom.in", "STAFF_SALES_PASSWORD_HASH"],
  "Scanner@56": ["scanner@petcom.in", "STAFF_SCANNER_PASSWORD_HASH"],
} as const;
const invalid: LoginState = { message: "The username or password is incorrect." };

let verificationInProgress = false;

async function verifyPassword(password: string, hash: string | undefined) {
  if (!hash || !/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash)) return false;
  const [salt, expected] = hash.split(":");
  if (verificationInProgress) return false;
  verificationInProgress = true;
  try {
    const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, "hex"), 32,
      { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key),
    );
    });
    return timingSafeEqual(actual, Buffer.from(expected, "hex"));
  } finally {
    verificationInProgress = false;
  }
}

export async function signIn(_state: LoginState, data: FormData): Promise<LoginState> {
  const username = String(data.get("username") ?? "").trim();
  const password = String(data.get("password") ?? "");
  if (!Object.hasOwn(accounts, username) || password.length < 16 || password.length > 128) return invalid;

  const [email, variable] = accounts[username as keyof typeof accounts];
  if (!(await verifyPassword(password, process.env[variable]))) return invalid;

  const [member] = await db.select().from(staff)
    .where(and(eq(staff.email, email), eq(staff.active, true))).limit(1);
  if (!member || (member.role !== "owner" && member.role !== "sales" && member.role !== "scanner")) return invalid;

  await setSessionCookie(buildSession({
    staffId: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
  }));
  if (member.role === "owner") redirect("/admin");
  redirect(member.role === "sales" ? "/sell" : "/scan");
}

export async function signOut() {
  await clearSessionCookie();
  redirect("/login");
}
