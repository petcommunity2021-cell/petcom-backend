export const IST_OFFSET_MINUTES = 330;

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return "₹" + rupees.toLocaleString("en-IN", {
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatIstDate(d: Date | string): string {
  return dateFmt.format(new Date(d));
}

export function formatIstTime(d: Date | string): string {
  return timeFmt.format(new Date(d)) + " IST";
}

export function formatIstDateTime(d: Date | string): string {
  return `${formatIstDate(d)} · ${formatIstTime(d)}`;
}

/** Mask a phone for public pages: keep the last 4 digits. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 4) return "••••";
  return "••••••" + digits.slice(-4);
}

/** Mask an email: a***@domain */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}•••@${domain}`;
}

/** Normalise an Indian phone to E.164 (+91XXXXXXXXXX). Throws on nonsense. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/\D+/g, "");
  if (digits.length === 10) return "+91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  if (digits.length === 13 && digits.startsWith("091")) return "+" + digits.slice(1);
  if (input.trim().startsWith("+") && digits.length >= 10) return "+" + digits;
  throw new Error("Enter a 10-digit Indian mobile number");
}

export function relativeFromNow(d: Date | string): string {
  const diffMs = Date.now() - new Date(d).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
