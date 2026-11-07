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

export function lookup(text: string): DirectoryEntry | undefined {
  return DIRECTORY.find((d) => d.match.test(text));
}
