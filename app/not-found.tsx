import Link from "next/link";
import { PublicFooter, PublicHeader } from "@/components/chrome";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader session={null} />
      <main className="mx-auto grid w-full max-w-lg flex-1 place-items-center px-4 py-16 text-center">
        <div>
          <p className="text-[0.72rem] font-extrabold uppercase tracking-[0.14em] text-accent">
            404
          </p>
          <h1 className="mt-1 text-3xl font-bold">Nothing here</h1>
          <p className="mt-2 text-sm text-ink-soft">
            This event may have been unpublished, or the ticket code is wrong. If you were about to
            walk into an event, show the desk your order confirmation.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link href="/" className="btn btn-primary">
              Events
            </Link>
            <Link href="/login" className="btn btn-ghost">
              Staff sign in
            </Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
