// Tiny demo directory for "the AI looks the number up". Real lookup is out of scope;
// numbers here are only ever dialled in mock mode unless they are on CALL_ALLOWLIST.

export interface DirectoryEntry {
  match: RegExp;
  name: string;
  phone: string;
}

const DIRECTORY: DirectoryEntry[] = [
  { match: /domino'?s?/i, name: "Domino's Storo", phone: "+4722000001" },
  { match: /peppes/i, name: "Peppes Pizza", phone: "+4722000002" },
  { match: /legekontor|fastlege|legen\b|doktor/i, name: "Legekontoret", phone: "+4722000003" },
  { match: /frisør/i, name: "Frisøren", phone: "+4722000004" },
];

// Demo override for real calls: DIRECTORY_OVERRIDE="+47XXXXXXXX" sends every directory hit
// (e.g. «Domino's Storo») to that number, so the phone demo rings a teammate, never a real shop.
const OVERRIDE = process.env.DIRECTORY_OVERRIDE?.trim();

export function lookup(text: string): DirectoryEntry | undefined {
  const hit = DIRECTORY.find((d) => d.match.test(text));
  return hit && OVERRIDE ? { ...hit, phone: OVERRIDE } : hit;
}
