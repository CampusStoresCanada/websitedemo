// 2000 is used as a leap-year reference so a "02-29" cutoff can't throw.
export function formatMonthDay(monthDay: string): string {
  const [month, day] = monthDay.split("-").map(Number);
  return new Date(2000, month - 1, day).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
  });
}
