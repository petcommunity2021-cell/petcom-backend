import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { staff } from "@/lib/db/schema";

export type Role = "owner" | "sales" | "scanner";

export type Session = {
  staffId: number;
  name: string;
  email: string;
  role: Role;
  exp: number; // unix ms
};

export const SESSION_COOKIE = "petcom_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 2; // two days at the venue

function secret(): string {
  return process.env.SESSION_SECRET ?? "insecure-dev-secret-please-set-SESSION_SECRET";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function serializeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseSession(value: string | undefined | null): Session | null {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!parsed.staffId || !parsed.role || !parsed.exp) return null;
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildSession(input: {
  staffId: number;
  name: string;
  email: string;
  role: Role;
}): Session {
  return { ...input, exp: Date.now() + SESSION_TTL_MS };
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const parsed = parseSession(store.get(SESSION_COOKIE)?.value);
  if (!parsed) return null;

  /*
   * The cookie is signed, not authoritative. Re-read the account so that
   * deactivating a person, deleting them, or changing their role takes effect
   * immediately instead of whenever the cookie happens to expire. The role
   * comes from the database, never from the token.
   */
  const [row] = await db
    .select({
      name: staff.name,
      email: staff.email,
      role: staff.role,
      active: staff.active,
    })
    .from(staff)
    .where(and(eq(staff.id, parsed.staffId), eq(staff.active, true)))
    .limit(1);

  if (!row) return null;

  return {
    staffId: parsed.staffId,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    exp: parsed.exp,
  };
}

export async function setSessionCookie(session: Session) {
  const store = await cookies();
  store.set(SESSION_COOKIE, serializeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}

export async function requireRole(roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) throw new Error("FORBIDDEN");
  return session;
}
