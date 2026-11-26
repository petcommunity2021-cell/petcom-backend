import { redirect } from "next/navigation";
import { CounterSaleForm, type SaleEvent } from "@/components/counter-sale-form";
import { PageHead } from "@/components/chrome";
import { StaffShell } from "@/components/staff-shell";
import { requireStaff } from "@/lib/auth/guard";
import { formatIstDate } from "@/lib/format";
import { availabilityFor } from "@/lib/domain/inventory";
import { publicEvents, tiersFor } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Counter sale" };

export default async function SellPage() {
  const session = await requireStaff(["owner", "sales"]);
  if (session.role === "scanner") redirect("/scan");

  const events = await publicEvents();

  const saleEvents: SaleEvent[] = [];
  for (const event of events) {
    const [tiers, availability] = await Promise.all([
      tiersFor(event.id),
      availabilityFor(event.id),
    ]);
    const left = new Map(availability.map((a) => [a.tierId, a.left]));
    saleEvents.push({
      id: event.id,
      title: event.title,
      startsAtLabel: formatIstDate(event.startsAt),
      tiers: tiers.map((tier) => ({
        id: tier.id,
        eventId: event.id,
        name: tier.name,
        pricePaise: tier.pricePaise,
        left: left.get(tier.id) ?? (left.has(tier.id) ? null : tier.quantity),
        perOrderLimit: tier.perOrderLimit,
      })),
    });
  }

  return (
    <StaffShell session={session} active="/sell">
      <PageHead
        eyebrow="Counter"
        title="Sell a ticket"
        sub="UPI and card issue instantly. Cash and comps become a request the owner approves — no QR exists until they do."
      />
      <div className="mt-5">
        <CounterSaleForm events={saleEvents} />
      </div>
    </StaffShell>
  );
}
