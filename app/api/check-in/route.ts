import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { checkIn } from "@/lib/domain/checkin";

/**
 * The door. Every scan is decided by one atomic UPDATE inside `checkIn`, so
 * two phones scanning the same QR cannot both be told "admitted".
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let token = "";
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token.trim() : "";
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  if (!token) {
    return NextResponse.json({ error: "Paste a ticket code first." }, { status: 400 });
  }

  const device = (request.headers.get("user-agent") ?? "web").slice(0, 80);
  const outcome = await checkIn(token, session.staffId, device);

  // 200 even for a refusal: the refusal is the answer, not a transport error.
  return NextResponse.json(outcome);
}
