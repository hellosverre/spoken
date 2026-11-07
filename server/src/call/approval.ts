// Approval cards the user taps during a call. Pure functions so each rule is testable
// (call c_cc7521a0c46d: «Hvilken restaurant og hva er adressen?» came with JA / NEI buttons,
// «Hvor mange?» with «Én / Flere», and the agent asked the user where it had called).

const WRITE = "Skriv svar";

/** A question that needs words, not a yes or a no. */
export function isOpenQuestion(q: string): boolean {
  return /^(hvilk\p{L}*|hva|hvor|når|hvem|hvordan|hvorfor|which|what|where|when|who|how|why)\b/iu.test(stripLead(q));
}

/** «Dominos spør: «…»» / «Domino's vil vite …» → the question itself. */
function stripLead(q: string): string {
  return q.replace(/^[^:«"]{0,40}(spør|lurer på|vil vite|asks|wants to know|is asking)[^:«"]*[:,]?\s*[«"]?/i, "").replace(/^«/, "").trim();
}

const YES_NO = /^(ja|nei|yes|no)$/i;

/**
 * Buttons that fit the question: an open question gets «Skriv svar» instead of JA / NEI, a
 * «how many» question gets numbers, and every choice card can be answered in words.
 */
export function fixCardOptions(question: string, options: string[]): string[] {
  const opts = options.map((o) => o.trim()).filter(Boolean);
  const yesNo = opts.length > 0 && opts.every((o) => YES_NO.test(o));
  if (yesNo && !isOpenQuestion(question)) return opts;
  if (/\b(hvor mange|how many)\b/i.test(question) && !opts.some((o) => /\d/.test(o))) return ["1", "2", WRITE];
  const kept = yesNo ? [] : opts.filter((o) => !/^(flere|noen|mange|annet)$/i.test(o));
  return kept.some((o) => /^skriv/i.test(o)) ? kept : [...kept, WRITE];
}

/** Asking the user which branch or address the place we called is: we know who we called. */
export function asksUserWhereCallee(question: string): boolean {
  return /\b(hvilken (restaurant|filial|butikk|avdeling|domino\p{L}*|sted)|hva er adressen (til|på) (restauranten|butikken|stedet|dem)|hvor (ligger|er) (restauranten|butikken|stedet|de|dere)|hvilken adresse)\b/iu.test(question)
    || (/\bhent\p{L}*\b/iu.test(question) && /\b(hvor|hvilken|adresse)\b/i.test(question) && /\b(restaurant|filial|butikk|sted|domino)/i.test(question));
}

/** The agent itself already pushed back on the price this call: say so on the card. */
export function priceWarning(question: string, agentLines: string[]): string {
  if (!/\b\d[\d .]*\s*(kr|kroner|,-)/i.test(question) && !/\b(kr|kroner)\b/i.test(question)) return "";
  const pushedBack = agentLines.some((l) => /\b(er (veldig |litt )?mye|veldig dyrt|virker (høyt|dyrt|mye|urimelig)|sjekke prisen|stemmer (det|prisen)\?)/i.test(l));
  return pushedBack ? "Obs: prisen virker høy. " : "";
}
