import { config } from "dotenv";

config({ path: ".env.local" });
config();

/**
 * One demo event plus the three accounts needed to walk the whole loop:
 * buy online, sell at the counter, approve cash, scan at the door.
 *
 * Safe to run twice: everything is keyed by a natural unique column.
 */
async function main() {
  const { db } = await import("../lib/db/client");
  const { events, messageTemplates, staff, ticketTypes } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");

  /* ---------------------------------------------------------------- staff */

  const team = [
    { name: "Hansh", email: "owner@petcom.in", role: "owner" },
    { name: "Priya", email: "seller@petcom.in", role: "sales" },
    { name: "Arun", email: "scanner@petcom.in", role: "scanner" },
  ];

  for (const person of team) {
    await db.insert(staff).values(person).onConflictDoNothing({ target: staff.email });
  }

  /* --------------------------------------------------------------- event */

  const slug = "diwali-with-pets";

  // 14 days out, 4:00 pm IST. Built in UTC because that is what the column stores.
  const start = new Date(Date.now() + 14 * 864e5 + 330 * 60_000);
  start.setUTCHours(10, 30, 0, 0); // 10:30 UTC = 16:00 IST

  const end = new Date(start.getTime() + 4 * 60 * 60_000);

  let [event] = await db.select().from(events).where(eq(events.slug, slug)).limit(1);

  if (!event) {
    [event] = await db
      .insert(events)
      .values({
        slug,
        title: "Diwali with Pets",
        description:
          "An evening of lights, treats and very good dogs. Bring your pet, meet the community, and go home with a photo you will actually print.\n\nGates open 30 minutes before the start. Pets must be on a leash or in a carrier.",
        venueName: "Cubbon Park, Bengaluru",
        venueMapUrl: "https://maps.google.com/?q=Cubbon+Park+Bengaluru",
        startsAt: start,
        endsAt: end,
        capacity: 30,
        status: "on_sale",
        publishedAt: new Date(),
        customFields: ["pet_name", "pet_breed"],
      })
      .returning();
    console.log(`  event   ${event.title} (/${event.slug})`);
  } else {
    console.log(`  event   ${event.title} already exists — leaving it alone`);
  }

  const existingTiers = await db
    .select({ id: ticketTypes.id })
    .from(ticketTypes)
    .where(eq(ticketTypes.eventId, event.id));

  if (existingTiers.length === 0) {
    await db.insert(ticketTypes).values([
      {
        eventId: event.id,
        name: "Adult + Pet",
        pricePaise: 49900,
        quantity: 20,
        perOrderLimit: 4,
        includesPet: true,
      },
      {
        eventId: event.id,
        name: "Adult only",
        pricePaise: 29900,
        quantity: 10,
        perOrderLimit: 4,
      },
    ]);
    console.log("  tiers   Adult + Pet ₹499 · Adult only ₹299");
  } else {
    console.log("  tiers   already present");
  }

  /* ----------------------------------------------------------- templates */

  await db
    .insert(messageTemplates)
    .values([
      {
        key: "ticket_email",
        channel: "email",
        subject: "Your Petcom ticket — {{event_title}}",
        body: "Hello {{customer_name}},\n\nYour ticket for {{event_title}} is attached.\n{{event_when}} · {{venue}}\n\nShow the QR at the gate. One scan per ticket.\n\n— Petcom",
        approved: true,
      },
      {
        key: "ticket_whatsapp",
        channel: "whatsapp",
        subject: null,
        body: "Your Petcom ticket for {{event_title}} is here: {{ticket_url}}",
        approved: false,
      },
      {
        key: "reminder_24h",
        channel: "email",
        subject: "Tomorrow: {{event_title}}",
        body: "See you tomorrow at {{venue}}. Gates open 30 minutes early.",
        approved: true,
      },
    ])
    .onConflictDoNothing({
      target: [messageTemplates.key, messageTemplates.channel],
    });

  console.log("  mail    3 templates");
  console.log("");
  console.log("  Sign in at /login with owner@petcom.in, seller@petcom.in or scanner@petcom.in");
  console.log("  The six-digit code is printed in the terminal running `npm run dev`.");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
