import { sql } from "drizzle-orm";

/**
 * The suite truncates before every test; this removes the last test's data
 * afterwards so a developer's dev database is not left holding "Test Event".
 */
export async function setup() {
  return async function teardown() {
    const { db } = await import("../lib/db/client");
    await db.execute(sql`
      truncate table
        change_responses, event_changes, owner_alerts, scheduled_jobs, event_automations,
        messages, message_templates, audit_log, tracking_events, customer_activity,
        refunds, payments, tickets, orders, customers, ticket_types, assets, events,
        otp_codes, auth_sessions, auth_users, staff, webhook_events, event_templates
      restart identity cascade
    `);
    const { sqlClient } = await import("../lib/db/client");
    await sqlClient.end({ timeout: 5 });
  };
}
