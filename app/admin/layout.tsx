import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff(["owner", "sales", "scanner"]);
  if (session.role === "scanner") redirect("/scan");
  if (session.role === "sales") redirect("/sell");
  return <>{children}</>;
}
