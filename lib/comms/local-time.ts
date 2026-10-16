/**
 * Per-recipient local event times, from the member's own province.
 *
 * Listing every zone in the body ("11:00 CT · 12:00 ET · …") makes the reader
 * find themselves in a list, and it gets Saskatchewan wrong: SK does not
 * observe DST, so from March to November it sits on Mountain time while the
 * rest of "Central" is an hour ahead. Lumping it under CT told our two
 * Saskatchewan stores to arrive an hour late.
 *
 * organizations.province is populated for every active member org (checked
 * 2026-10-05, 50 of 50), so the right time can be computed per recipient
 * instead.
 */

/**
 * Province name as stored in organizations.province → IANA zone.
 *
 * Keyed on the full names the column actually holds ("British Columbia", not
 * "BC"), with two-letter codes accepted as a fallback for hand-entered data.
 *
 * ⚠️ Province is not strictly a timezone, but the exceptions are narrow and
 * verified (2026-10-05) against the tz database rather than assumed:
 *
 *   BC      Creston, Dawson Creek/Fort St. John and Fort Nelson are MST with
 *           no DST. Between March and November that is the same clock time
 *           as Pacific (both UTC-7), so only the abbreviation would read
 *           wrong; in winter they genuinely diverge by an hour. Prince
 *           George is Pacific, not one of these.
 *   ON      Thunder Bay is Eastern (Lakehead is correct). The real
 *           exceptions are Rainy River (Central) and Atikokan (EST, no DST),
 *           both an hour off Toronto year-round.
 *   QC      The Lower North Shore east of Natashquan is Atlantic.
 *
 * No active CSC member store sits in any of these pockets today. Re-check if
 * one joins from the BC Peace region, north-west Ontario, or the Quebec
 * Lower North Shore, and re-check regardless for a winter event.
 */
const PROVINCE_ZONES: Record<string, string> = {
  "alberta": "America/Edmonton",
  "ab": "America/Edmonton",
  "british columbia": "America/Vancouver",
  "bc": "America/Vancouver",
  "manitoba": "America/Winnipeg",
  "mb": "America/Winnipeg",
  "new brunswick": "America/Moncton",
  "nb": "America/Moncton",
  "newfoundland and labrador": "America/St_Johns",
  "newfoundland": "America/St_Johns",
  "nl": "America/St_Johns",
  "northwest territories": "America/Yellowknife",
  "nt": "America/Yellowknife",
  "nova scotia": "America/Halifax",
  "ns": "America/Halifax",
  "nunavut": "America/Iqaluit",
  "nu": "America/Iqaluit",
  "ontario": "America/Toronto",
  "on": "America/Toronto",
  "prince edward island": "America/Halifax",
  "pe": "America/Halifax",
  "pei": "America/Halifax",
  "quebec": "America/Toronto",
  "québec": "America/Toronto",
  "qc": "America/Toronto",
  "saskatchewan": "America/Regina",
  "sk": "America/Regina",
  "yukon": "America/Whitehorse",
  "yt": "America/Whitehorse",
};

export function zoneForProvince(province: string | null | undefined): string | null {
  if (!province) return null;
  return PROVINCE_ZONES[province.trim().toLowerCase()] ?? null;
}

/**
 * "10:00 a.m. MDT" for the given instant in the given province, in the
 * house style (lowercase a.m./p.m., :30 kept, :00 dropped).
 *
 * Returns null when the province is unknown, so callers fall back to stating
 * the time in one zone rather than printing something wrong.
 */
export function formatLocalEventTime(
  instant: Date,
  province: string | null | undefined
): string | null {
  const zone = zoneForProvince(province);
  if (!zone) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour");
  const minute = get("minute");
  const meridiem = get("dayPeriod").toLowerCase().replace("am", "a.m.").replace("pm", "p.m.");
  const abbreviation = get("timeZoneName");

  const clock = minute === "00" ? hour : `${hour}:${minute}`;
  return `${clock} ${meridiem} ${abbreviation}`;
}

/**
 * The sentence that goes in the email. Falls back to the organizer's zone
 * when the province is unknown, which is strictly better than guessing.
 */
export function localEventTimeSentence(
  instant: Date,
  province: string | null | undefined,
  fallbackZoneLabel: string
): string {
  const local = formatLocalEventTime(instant, province);
  return local ? `${local} where you are` : fallbackZoneLabel;
}
