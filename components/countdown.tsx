"use client";

import { useEffect, useState } from "react";

function msLeft(target: number) {
  return Math.max(0, target - Date.now());
}

function clock(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Countdown({
  to,
  className,
  prefix = "Held for",
  expiredLabel = "Hold expired",
}: {
  to: string;
  className?: string;
  prefix?: string;
  expiredLabel?: string;
}) {
  const target = new Date(to).getTime();
  const [left, setLeft] = useState(() => msLeft(target));

  useEffect(() => {
    const id = setInterval(() => setLeft(msLeft(target)), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (left <= 0) {
    return <span className={className}>{expiredLabel}</span>;
  }

  return (
    <span className={className} suppressHydrationWarning>
      {prefix} {clock(left)}
    </span>
  );
}
