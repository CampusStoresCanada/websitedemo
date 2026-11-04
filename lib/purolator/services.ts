// Purolator's service ids in desk words. Pure, so the browser can use it.

/** "PurolatorExpress9AM" → "Express 9 AM", "PurolatorExpress1030AM" → "Express 10:30 AM". */
export function serviceName(serviceId: string): string {
  return serviceId
    .replace(/^Purolator/, "")
    // The sandbox sends "Express10:30AM"; older docs show "Express1030AM".
    .replace(/(\d{1,2}):?(\d{2})?(AM|PM)/, (_, h: string, m: string | undefined, p: string) => ` ${h}${m ? `:${m}` : ""} ${p}`)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}
