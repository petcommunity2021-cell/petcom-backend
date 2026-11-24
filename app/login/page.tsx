import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { PublicFooter, PublicHeader, Wordmark } from "@/components/chrome";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Staff sign in" };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.role === "scanner" ? "/scan" : "/admin");

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader session={null} />

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-6">
          <Wordmark />
          <h1 className="mt-4 text-2xl font-bold">Sign in to the desk</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Owner, sales and scanner accounts. No password to forget — a six-digit code does it.
          </p>
        </div>

        <LoginForm />

        <div className="mt-5 rounded-xl border border-line bg-paper/70 p-4 text-xs leading-relaxed text-muted">
          <p className="font-bold text-ink-soft">Demo accounts (after `npm run db:seed`)</p>
          <ul className="mt-1.5 space-y-0.5 font-mono">
            <li>owner@petcom.in · owner (approves cash)</li>
            <li>seller@petcom.in · sales (counter, scanner)</li>
            <li>scanner@petcom.in · scanner (door only)</li>
          </ul>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          <Link href="/" className="font-bold underline">
            Back to the event page
          </Link>
        </p>
      </main>

      <PublicFooter />
    </div>
  );
}
