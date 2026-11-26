import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { PublicFooter, PublicHeader, Wordmark } from "@/components/chrome";
import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "Staff sign in" };

export default async function LoginPage() {
  const session = await getSession();
  if (session?.role === "owner") redirect("/admin");
  if (session) redirect(session.role === "sales" ? "/sell" : "/scan");

  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader session={null} />

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-6">
          <Wordmark />
          <h1 className="mt-4 text-2xl font-bold">Sign in to the desk</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Enter your staff username and password.
          </p>
        </div>

        <LoginForm />

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
