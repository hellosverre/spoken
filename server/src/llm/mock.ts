// Rule-based stand-in for the LLM. Good enough to run the scripted demo and to hold a
// simple Norwegian conversation on a real test call when no LLM key is set.

import type { Question, Shareable } from "../../../shared/contract.ts";
import { lookup } from "../directory.ts";
import { calleeProposesCommitment } from "../safety.ts";
import type { AgentContext, ClarifyOut, LlmProvider, PlanOut, SummaryOut, TaskForLlm } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastOf(ctx: AgentContext, role: string) {
  for (let i = ctx.history.length - 1; i >= 0; i--) if (ctx.history[i]!.role === role) return ctx.history[i]!.text;
  return "";
}

/** "Bestill en stor pepperoni fra Domino's Storo til 18:00" → "bestille en stor pepperoni til 18:00". */
export function goalSentence(text: string): string {
  let g = text.trim().replace(/[.!]+$/, "");
  g = g.replace(/\s+(fra|hos|på|med)\s+(domino'?s|peppes)[^,]*?(?=\s+(til|kl|klokka|for)\b|$)/i, "");
  g = g.replace(/^(kan du |vær så snill og |please )/i, "");
  g = g.replace(/^bestill\b/i, "bestille").replace(/^book\b/i, "bestille").replace(/^ring (til )?[^,]+? (og|for å) /i, "");
  g = g.replace(/^avbestill\b/i, "avbestille");
  return g.charAt(0).toLowerCase() + g.slice(1);
}

function isFood(text: string) {
  return /pizza|pepperoni|domino|peppes|kebab|burger|sushi|bestill.*mat/i.test(text);
}

export function mockClarify(task: TaskForLlm): ClarifyOut {
  const t = task.text;
  const qs: Question[] = [];
  const hit = lookup(t);
  if (!task.phone && !hit) qs.push({ id: "phone", text: "Hvilket nummer skal jeg ringe?" });
  if (isFood(t)) {
    if (!/hent|lever/i.test(t)) qs.push({ id: "pickup", text: "Henting eller levering?", options: ["Henting", "Levering"] });
    if (!/\d{1,2}[:.]\d{2}|\bkl\b|klokka/i.test(t)) qs.push({ id: "time", text: "Når vil du ha den?", options: ["Så fort som mulig", "18:00", "19:00"] });
    qs.push({ id: "maxPrice", text: "Hvor mye kan den koste? Jeg spør deg uansett før jeg sier ja.", options: ["Opptil 250 kr", "Opptil 400 kr", "Spør meg alltid"] });
  } else if (/time|lege|frisør|book/i.test(t)) {
    qs.push({ id: "when", text: "Hvilke tider passer?", options: ["Formiddag", "Ettermiddag", "Hva som helst"] });
  }
  qs.push({ id: "confirm", text: `Stemmer det at jeg skal ${goalSentence(t)}?`, options: ["Ja", "Nei, endre"] });
  return { summary: `Ringe ${hit?.name ?? task.phone ?? "et nummer"} for å ${goalSentence(t)}.`, questions: qs };
}

export function mockPlan(task: TaskForLlm, answers: Record<string, string>): PlanOut {
  const hit = lookup(task.text);
  let goal = goalSentence(task.text);
  if (answers.pickup && !/hent|lever/i.test(goal)) {
    const how = answers.pickup === "Levering" ? "med levering" : "til henting";
    const t = /\s+(til|klokka|kl\.?)\s+(\d{1,2}[:.]\d{2})/i;
    goal = t.test(goal) ? goal.replace(t, ` ${how} klokka $2`) : `${goal} ${how}`;
  }
  if (answers.time && !/\d{1,2}[:.]\d{2}/.test(goal) && answers.time !== "Så fort som mulig") goal += ` klokka ${answers.time}`;
  const willShare: Shareable[] = ["name"];
  if (answers.pickup === "Levering") willShare.push("address");
  if (task.profile.allergies) willShare.push("allergies");
  const needs = ["pris over 0 kr", "å bekrefte en bestilling eller time"];
  if (answers.maxPrice && answers.maxPrice !== "Spør meg alltid") needs[0] = `pris (grense: ${answers.maxPrice.toLowerCase()})`;
  return {
    calleeName: hit?.name ?? answers.callee ?? "Mottaker",
    phone: task.phone ?? answers.phone ?? hit?.phone,
    goal,
    willShare,
    needsApprovalFor: needs,
  };
}

/** Decides the next agent line from the last thing that happened. */
export function mockReplyText(ctx: AgentContext): string {
  const last = ctx.history[ctx.history.length - 1];
  const callee = lastOf(ctx, "callee");
  const name = ctx.userName || "brukeren";

  if (last?.role === "user") {
    const t = last.text;
    if (/^\[godkjent\].*\{\{ADDRESS\}\}/i.test(t)) return "Adressen er {{ADDRESS}}.";
    if (/^\[avslått\].*adresse/i.test(t)) return "Beklager, adressen kan jeg ikke oppgi. Kan vi gjøre det på en annen måte?";
    if (/^\[godkjent\]/i.test(t)) return "Ja takk, da bekrefter jeg det.";
    if (/^\[avslått\]/i.test(t)) return "Nei takk, da lar vi det være. Takk for hjelpen, ha det bra! [[END: partial | Brukeren takket nei.]]";
    if (/^\[svar\]/i.test(t)) return t.replace(/^\[svar\]\s*/i, "") + ".";
    if (/^\[avslutt\]/i.test(t)) return "Jeg må dessverre avslutte nå. Tusen takk, ha det bra! [[END: partial | Brukeren avsluttet samtalen.]]";
    if (/^\[enklere\]/i.test(t)) {
      const prev = lastOf(ctx, "agent").replace(/\[\[.*?\]\]/g, "").split(/(?<=[.!?])\s/)[0] ?? "";
      return `Enkelt sagt: ${prev}`;
    }
    return `En ting til fra ${name}: ${t.replace(/^\[instruks\]\s*/i, "")}`;
  }

  const c = callee.toLowerCase();
  if (/^(nei|nei takk)\b|vil ikke snakke|snakker ikke med (en )?(robot|maskin|ki)/.test(c)) {
    return "Det er helt i orden. Ha en fin dag! [[END: refused | Mottakeren ville ikke snakke med en KI-assistent.]]";
  }
  if (/ha det|takk for (nå|samtalen)|ha en fin/.test(c)) {
    const approved = ctx.history.some((h) => h.role === "user" && /^\[godkjent\]/i.test(h.text));
    return `Tusen takk, ha det bra! [[END: ${approved ? "done" : "partial"} | Samtalen er ferdig.]]`;
  }
  if (calleeProposesCommitment(callee)) {
    const q = callee.replace(/\s+/g, " ").trim();
    return `[[ASK: Si ja til dette? «${q}» | JA | NEI]]`;
  }
  if (/navn(et)?|hvem (er det|skal)|på hvem/.test(c)) return `Den står på ${name}.`;
  if (/allerg/.test(c)) return ctx.profileFacts.allergies ? `Ja: ${ctx.profileFacts.allergies}.` : "Nei, ingen allergier.";
  if (/hva skal det være|hva kan jeg (hjelpe|gjøre)|hvordan kan jeg hjelpe|hva gjelder|hva (vil|ønsker) du|ja\??$|^hei|hallo|værsågod|det går fint|ok/.test(c)) {
    return `Jeg vil gjerne ${ctx.goal}.`;
  }
  if (/vent|et øyeblikk|ett øyeblikk|sekund/.test(c)) return "Ja, jeg venter.";
  return "Beklager, linja er litt dårlig. Kan du si det en gang til?";
}

export function mockSummary(ctx: AgentContext): SummaryOut {
  const calleeAll = ctx.history.filter((h) => h.role === "callee").map((h) => h.text).join(" ");
  const approved = ctx.history.some((h) => h.role === "user" && /^\[godkjent\]/i.test(h.text));
  const declined = ctx.history.some((h) => h.role === "user" && /^\[avslått\]/i.test(h.text));
  const refused = ctx.history.some((h) => h.role === "agent" && /\[\[END: refused/.test(h.text));
  const details: Record<string, string> = {};
  const price = calleeAll.match(/(\d+)\s*(kr|kroner)/i);
  if (price) details.pris = `${price[1]} kr`;
  const time = calleeAll.match(/\b(\d{1,2}[:.]\d{2})\b/) ?? ctx.goal.match(/\b(\d{1,2}[:.]\d{2})\b/);
  if (time) details.tid = time[1]!.replace(".", ":");
  const outcome = refused ? "refused" : approved ? "done" : declined ? "partial" : "partial";
  const what = ctx.goal.charAt(0).toUpperCase() + ctx.goal.slice(1);
  const doneWhat = what.replace(/^Bestille\b/, "Bestilt:").replace(/^Booke\b/, "Booket:").replace(/^Avbestille\b/, "Avbestilt:");
  const summary = outcome === "done"
    ? `${doneWhat === what ? `Ferdig: ${what}` : doneWhat}${details.pris ? `, ${details.pris}` : ""}.`
    : outcome === "refused" ? `${ctx.calleeName} ville ikke snakke med en KI-assistent.` : `Ikke fullført: ${what}.`;
  return { outcome, summary, details };
}

export class MockLlm implements LlmProvider {
  name = "mock";
  constructor(private tokenDelayMs = 15) {}

  async clarify(task: TaskForLlm) { return mockClarify(task); }
  async plan(task: TaskForLlm, answers: Record<string, string>) { return mockPlan(task, answers); }
  async summarize(ctx: AgentContext) { return mockSummary(ctx); }

  async *reply(ctx: AgentContext, signal: AbortSignal): AsyncIterable<string> {
    const text = mockReplyText(ctx);
    // Stream word by word so the pipeline exercises the same sentence splitting as a real model.
    for (const w of text.split(/(?<=\s)/)) {
      if (signal.aborted) return;
      if (this.tokenDelayMs) await sleep(this.tokenDelayMs);
      yield w;
    }
  }
}
