import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Utility for merging Tailwind classes
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Delay utility for animations
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Format phone number for display
export function formatPhone(phone: string): string {
  return phone;
}

// Generate slug from name
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Parse a Supabase timestamp as UTC. Supabase returns "YYYY-MM-DD HH:mm:ss"
 * with no tz marker — JS treats that as local time, not UTC. This appends "Z"
 * to force UTC interpretation.
 */
export function parseUTC(s: string): Date {
  const utc = s.endsWith("Z") || s.includes("+") ? s : s.replace(" ", "T") + "Z";
  return new Date(utc);
}

/**
 * Format a Supabase timestamp string for display, normalizing to UTC first.
 * Safe in both server and client contexts. On the server this uses UTC;
 * in the browser it uses the user's local timezone via toLocaleString.
 */
export function formatUTC(
  s: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback = "Never"
): string {
  if (!s) return fallback;
  return parseUTC(s).toLocaleString("en-CA", options);
}

// Format cents to CAD currency string
export function formatCents(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
  }).format(value / 100);
}

/** "February 1–4, 2027" (same month) or "January 30 – February 4, 2027" (spanning months), from YYYY-MM-DD strings. */
export function formatDateRange(startIso: string, endIso: string): string {
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear();
  if (sameMonth) {
    const month = start.toLocaleDateString("en-CA", { month: "long", timeZone: "UTC" });
    return `${month} ${start.getUTCDate()}–${end.getUTCDate()}, ${end.getUTCFullYear()}`;
  }
  const full = (d: Date) => d.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${full(start)} – ${full(end)}`;
}
