import { redirect } from "next/navigation";
import { getSession, type Role, type Session } from "@/lib/auth/session";

/**
 * Page-level guard. Domain code still re-checks the role — this only decides
 * what a person is allowed to look at, never what they are allowed to do.
 */
export async function requireStaff(roles?: Role[]): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (roles && !roles.includes(session.role)) redirect("/");
  return session;
}

export async function optionalStaff(): Promise<Session | null> {
  return getSession();
}
