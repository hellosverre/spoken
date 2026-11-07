/**
 * Phone-book numbers → E.164, +47 by default. Mirrors server/src/safety.ts normalizePhone
 * (the server re-checks every number), plus the formats address books use:
 * "+47 912 34 567", "0047 91234567", "(47) 912-34-567", "91 23 45 67".
 * Returns "" for anything that can't be a dialable number (short codes, junk).
 */
export function toE164(raw: string, defaultCountry = "47"): string {
  const s = raw.replace(/[\s\-(). ]/g, "");
  let digits: string;
  if (s.startsWith("+")) digits = s.slice(1).replace(/\D/g, "");
  else if (s.startsWith("00")) digits = s.slice(2).replace(/\D/g, "");
  else {
    digits = s.replace(/\D/g, "");
    if (digits.length === 8) digits = defaultCountry + digits;
    else if (!(digits.length === 10 && digits.startsWith(defaultCountry))) return "";
  }
  if (digits.startsWith("47") && digits.length !== 10) return "";
  return digits.length >= 8 && digits.length <= 15 ? "+" + digits : "";
}

/** A contact's numbers, normalised and de-duplicated, unusable ones dropped. */
export function e164List(raws: readonly string[]): string[] {
  return [...new Set(raws.map((r) => toE164(r)).filter(Boolean))];
}
