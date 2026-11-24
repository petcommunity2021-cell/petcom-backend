"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders a server component on a timer. Used while an approval is pending. */
export function AutoRefresh({ seconds = 12 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
