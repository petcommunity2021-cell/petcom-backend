import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { expirePendingApprovals } from "@/lib/domain/counter-sales";
import { alertStaleApprovals, expireStaleHolds } from "@/lib/domain/inventory";

/**
 * Sweeper. Everything here is idempotent, so running it twice (or from two
 * places) is harmless. In production a Vercel Cron or n8n hits this with the
 * bearer secret; in v1 the same URL works for a signed-in owner.
 */
async function sweep() {
  const [online, approvals, alerts] = await Promise.all([
    expireStaleHolds(),
    expirePendingApprovals(),
    alertStaleApprovals(),
  ]);

  return {
    expiredOnlineHolds: online.expiredOnline,
    expiredCashRequests: approvals.expired,
    slowApprovalAlerts: alerts.alerted,
    at: new Date().toISOString(),
  };
}

async function authorised(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (secret && header === `Bearer ${secret}`) return true;
  const session = await getSession();
  return Boolean(session);
}

export async function POST(request: Request) {
  if (!(await authorised(request))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  return NextResponse.json(await sweep());
}

export async function GET(request: Request) {
  if (!(await authorised(request))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }
  return NextResponse.json(await sweep());
}
