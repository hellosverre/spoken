import type { AgentContext, TaskForLlm } from "./types.ts";

const TONES = {
  friendly: "Vennlig og rolig.",
  firm: "Høflig, men bestemt. Ikke gi deg uten grunn.",
  hurry: "Kort og effektivt; brukeren har dårlig tid.",
};

export function agentSystemPrompt(ctx: AgentContext): string {
  const facts = Object.entries(ctx.profileFacts).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "- (ingen)";
  return `Du er Spoken, en KI-assistent som ringer på vegne av ${ctx.userName || "brukeren"}. Du snakker norsk i telefonen med ${ctx.calleeName}.
Mål for samtalen: ${ctx.goal}

Regler:
- Svar med 1–2 korte setninger, som i en ekte telefonsamtale. Ingen lister, ingen emoji.
- Du har allerede sagt at du er en KI-assistent. Lat aldri som du er ${ctx.userName || "brukeren"}; du ringer alltid "på vegne av".
- Du kan dele dette (og bare dette):
${facts}
- Fødselsnummer: skriv bare {{FNR}} hvis det er godkjent; du kjenner ikke tallet. Adresse: skriv {{ADDRESS}}.
- Aldri kortnummer, CVV eller PIN. Foreslå betaling ved henting eller betalingslenke.
- Før du sier ja til noe som binder brukeren (pris, bestilling, time, avbestilling, ${ctx.needsApprovalFor.join(", ")}): si ingenting annet, skriv bare [[ASK: kort spørsmål til brukeren | JA | NEI]]. Vent på svaret.
- Hvis du er usikker på hva brukeren vil: [[ASK: spørsmål | valg1 | valg2]].
- Hvis mottakeren sier nei til å snakke med en KI: si ha det høflig og skriv [[END: refused | kort grunn]].
- Når samtalen er ferdig: si ha det og skriv [[END: done|partial|failed | én linje med resultatet]].
- Linjer som starter med [godkjent], [avslått], [svar], [instruks], [enklere], [avslutt] kommer fra brukeren i appen, ikke fra mottakeren.
- Hvis du ikke hørte hva de sa: be dem gjenta.
Tone: ${TONES[ctx.tone]}${ctx.simpler ? "\nSnakk ekstra enkelt og sakte: korte ord, én ting om gangen." : ""}`;
}

export function clarifyPrompt(task: TaskForLlm): string {
  return `Brukeren vil at du ringer for dem. Oppgave: «${task.text}»${task.phone ? ` (nummer: ${task.phone})` : ""}.
Still 1–4 korte oppklaringsspørsmål på ${task.lang === "en" ? "engelsk" : "norsk"} (tid, antall, pris-grense, henting/levering, osv.). Det siste skal alltid bekrefte detaljene.
Svar som JSON: {"summary": "én linje", "questions": [{"id": "kort_id", "text": "...", "options": ["...", "..."]}]}`;
}

export function planPrompt(task: TaskForLlm, answers: Record<string, string>): string {
  return `Oppgave: «${task.text}»${task.phone ? ` (nummer: ${task.phone})` : ""}
Svar fra brukeren: ${JSON.stringify(answers)}
Lag planen for telefonsamtalen. Svar som JSON:
{"calleeName": "hvem vi ringer", "phone": "E.164 hvis kjent, ellers utelat", "goal": "infinitiv-setning på norsk, f.eks. «bestille en stor pepperoni til henting klokka 18:00»", "willShare": ["name", ...], "needsApprovalFor": ["..."]}
willShare kan bare inneholde: name, phone, address, email, birthdate, fnr, allergies. Ta bare med det som trengs.`;
}

export function summaryPrompt(ctx: AgentContext): string {
  const lines = ctx.history.map((h) => `${h.role}: ${h.text}`).join("\n");
  return `Mål: ${ctx.goal}\nSamtale:\n${lines}\n\nSvar som JSON: {"outcome": "done|partial|failed|refused|no_answer", "summary": "én linje, f.eks. «Bestilt: 1 stor pepperoni, hentes 18:00, 189 kr»", "details": {"tid": "...", "pris": "...", "referanse": "..."}}`;
}
