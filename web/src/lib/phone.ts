/** Display form of a stored E.164 number: +4722150000 → +47 22 15 00 00. Others pass through. */
export function formatPhone(e164: string): string {
  const no = /^\+47(\d{8})$/.exec(e164.replace(/\s/g, ""));
  if (!no) return e164;
  const n = no[1];
  // Mobile numbers (4xx, 9xx) group as 3-2-3, landlines as 2-2-2-2.
  return /^[49]/.test(n)
    ? `+47 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5)}`
    : `+47 ${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4, 6)} ${n.slice(6)}`;
}
