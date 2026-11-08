// Compliance receipt, built from what actually happened on the call (never from the plan):
// was the AI disclosed, which personal fields were spoken aloud, what the user approved or declined.
import type { Lang, Profile, Receipt, TranscriptLine } from "../../../shared/contract.ts";
import { digitWords } from "../voice/speakable.ts";

export interface ApprovalLogItem { question: string; choice: string }

export interface ReceiptInput {
  transcript: TranscriptLine[];
  profile: Pick<Profile, "name" | "phone" | "address" | "email" | "allergies">;
  approvals: ApprovalLogItem[];
  callee: string;
  durationSec: number;
  lang: Lang;
}

const DISCLOSES_AI = /\b(ki-assistent|ki assistent|kunstig intelligens|ai[- ]assistant|ai assistant|an ai\b|a\.i\.|virtual assistant|digital assistent)/i;
const NO_CHOICE = /^\s*(nei|no|avslå|avslå\b.*|decline|reject|nope)\s*$/i;
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const digitsOf = (s: string) => s.replace(/\D/g, "");

export const STORED: Record<Lang, string> = {
  no: "Bare oppsummeringen lagres. Ingen lydopptak, ingen samtaletekst.",
  en: "Only the summary is kept. No audio, no transcript.",
};

/** Which personal fields the agent said aloud, found in the agent's own lines. */
export function sharedFields(agentLines: string[], profile: ReceiptInput["profile"]): string[] {
  const said = agentLines.join(" \n ");
  const flat = squash(said);
  const digits = digitsOf(said);
  const out: string[] = [];
  const first = squash(profile.name).split(" ")[0];
  if (first && first.length > 1 && new RegExp(`(^| )${first}( |$)`).test(flat)) out.push("name");
  const phone = digitsOf(profile.phone ?? "").replace(/^(0047|47)(?=\d{8}$)/, "");
  if (phone.length >= 6 && (digits.includes(phone) || flat.includes(squash(digitWords(phone))))) out.push("phone");
  const addr = squash(profile.address ?? "");
  if (addr && (flat.includes(addr) || /\[adresse\]/i.test(said))) out.push("address");
  const email = (profile.email ?? "").toLowerCase();
  if (email && said.toLowerCase().includes(email)) out.push("email");
  const allergens = (profile.allergies ?? "").split(/[,;/]|\bog\b|\band\b/i).map(squash).filter((a) => a.length >= 4);
  if (allergens.some((a) => flat.includes(a))) out.push("allergies");
  if (/\[fødselsnummer\]|\[national id\]/i.test(said)) out.push("fnr");
  return out;
}

export function buildReceipt(i: ReceiptInput): Receipt {
  const agent = i.transcript.filter((l) => l.who === "agent");
  const first = agent[0]?.text;
  const disclosedAsAi = !!first && DISCLOSES_AI.test(first);
  const agreed: Receipt["agreed"] = [];
  const declined: Receipt["declined"] = [];
  for (const a of i.approvals) (NO_CHOICE.test(a.choice) ? declined : agreed).push({ question: a.question, choice: a.choice });
  return {
    lang: i.lang,
    callee: i.callee,
    durationSec: i.durationSec,
    disclosedAsAi,
    ...(disclosedAsAi ? { disclosure: first } : {}),
    shared: sharedFields(agent.map((l) => l.text), i.profile),
    agreed,
    declined,
    stored: STORED[i.lang],
  };
}
