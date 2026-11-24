import { randomBytes } from "node:crypto";

/**
 * 128 bits of randomness, URL-safe. The QR encodes the full ticket URL
 * (`/ticket/<token>`), so the scanner reads it straight off the code.
 */
export function generateQrToken(): string {
  return randomBytes(16).toString("base64url");
}

export function ticketUrl(token: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/ticket/${token}`;
}
