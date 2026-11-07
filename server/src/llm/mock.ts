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

/** "Order a large pepperoni from Domino's Storo for 6pm" → "order a large pepperoni for 6pm". */
export function goalSentenceEn(text: string): string {
  let g = text.trim().replace(/[.!]+$/, "");
  g = g.replace(/\s+(from|at)\s+(domino'?s|peppes)[^,]*?(?=\s+(for|at|by|around)\b|$)/i, "");
  g = g.replace(/^(can you |could you |please )/i, "").replace(/^call [^,]+? (and|to) /i, "");
  g = g.replace(/\s+(in|speak|on) english\b/i, "");
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
  const en = task.callLang === "en";
  let goal = en ? goalSentenceEn(task.text) : goalSentence(task.text);
  if (en) {
    if (answers.pickup && !/pick ?up|deliver/i.test(goal)) goal += answers.pickup === "Levering" ? " for delivery" : " for pickup";
    if (answers.time && !/\d/.test(goal) && answers.time !== "Så fort som mulig") goal += ` at ${answers.time}`;
  } else if (answers.pickup && !/hent|lever/i.test(goal)) {
    const how = answers.pickup === "Levering" ? "med levering" : "til henting";
    const t = /\s+(til|klokka|kl\.?)\s+(\d{1,2}[:.]\d{2})/i;
    goal = t.test(goal) ? goal.replace(t, ` ${how} klokka $2`) : `${goal} ${how}`;
  }
  if (!en && answers.time && !/\d{1,2}[:.]\d{2}/.test(goal) && answers.time !== "Så fort som mulig") goal += ` klokka ${answers.time}`;
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

/** English version of mockReplyText: same moves, fewer phrasings. */
function mockReplyTextEn(ctx: AgentContext): string {
  const last = ctx.history[ctx.history.length - 1];
  const callee = lastOf(ctx, "callee");
  const name = ctx.userName || "the user";
  if (last?.role === "user") {
    const t = last.text;
    if (/^\[godkjent\].*\{\{ADDRESS\}\}/i.test(t)) return "The address is {{ADDRESS}}.";
    if (/^\[avslått\].*adresse/i.test(t)) return "Sorry, I can't give the address. Could we do it another way?";
    if (/^\[godkjent\]/i.test(t)) return "Yes please, I confirm that.";
    if (/^\[avslått\]/i.test(t)) return "No thanks, let's leave it there. Thanks for your help, goodbye! [[END: partial | Brukeren takket nei.]]";
    if (/^\[svar\]/i.test(t)) return t.replace(/^\[svar\]\s*/i, "") + ".";
    if (/^\[avslutt\]/i.test(t)) return "I'm afraid I have to end the call now. Thank you, goodbye! [[END: partial | Brukeren avsluttet samtalen.]]";
    return `One more thing from ${name}: ${t.replace(/^\[(instruks|enklere)\]\s*/i, "")}`;
  }
  const c = callee.toLowerCase();
  if (/^no\b|don'?t want to talk|not talking to (a )?(robot|machine|ai)/.test(c)) {
    return "That's completely fine. Have a nice day! [[END: refused | Mottakeren ville ikke snakke med en KI-assistent.]]";
  }
  if (/goodbye|\bbye\b|have a (nice|good)/.test(c)) {
    const approved = ctx.history.some((h) => h.role === "user" && /^\[godkjent\]/i.test(h.text));
    return `Thank you, goodbye! [[END: ${approved ? "done" : "partial"} | Samtalen er ferdig.]]`;
  }
  if (calleeProposesCommitment(callee)) return `[[ASK: Si ja til dette? «${callee.replace(/\s+/g, " ").trim()}» | JA | NEI]]`;
  if (/\bname\b|who is it for/.test(c)) return `It's under ${name}.`;
  if (/allerg/.test(c)) return ctx.profileFacts.allergies ? `Yes: ${ctx.profileFacts.allergies}.` : "No, no allergies.";
  const goalSaid = ctx.history.some((h) => h.role === "agent" && h.text.startsWith("I'd like to"));
  if (!goalSaid) return `I'd like to ${ctx.goal}.`;
  if (/hold on|one (moment|second)|just a (moment|sec)/.test(c)) return "Sure, I'll wait.";
  if (/say that again/.test(lastOf(ctx, "agent"))) return `Thanks. To sum up: I'd like to ${ctx.goal}. Is that possible?`;
  return "Sorry, the line is a bit bad. Could you say that again?";
}

/** Decides the next agent line from the last thing that happened. */
export function mockReplyText(ctx: AgentContext): string {
  if (ctx.lang === "en") return mockReplyTextEn(ctx);
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
  // Phone menu: pick the option whose label shares a word with the goal, else the first.
  if (/trykk\s+\d/.test(c) && !/\bkan jeg hjelpe\b/.test(c)) {
    const opts = [...c.matchAll(/(?:trykk\s+(\d)\s+for\s+([^.,]+))|(?:for\s+([^.,]+?),?\s+trykk\s+(\d))/g)]
      .map((m) => ({ key: m[1] ?? m[4]!, label: (m[2] ?? m[3] ?? "").trim() }));
    const goal = ctx.goal.toLowerCase();
    const stem = (w: string) => w.slice(0, 5);
    const hit = opts.find((o) => o.label.split(/\s+/).some((w) => w.length > 3 && goal.includes(stem(w)))) ?? opts[0];
    if (hit) return `[[DTMF: ${hit.key}]]`;
  }
  if (/telefonsvar|legg igjen en beskjed|etter pipetonen/.test(c)) return "[[END: no_answer | Telefonsvarer]]";
  if (/snakke med (en person|et menneske|personen|vedkommende|han|henne|ham)|(menneske|person) (på linja|selv)|er du en (robot|maskin)|selv\b.*\bsnakke/.test(c)) {
    const q = callee.replace(/\s+/g, " ").trim();
    return `Beklager, ${name} er døv og kan ikke ta samtaler, så jeg formidler alt i tekst. [[ASK: Mottakeren vil snakke med deg: «${q}». Hva skal jeg si? | Legg på]]`;
  }
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
  // A yes after we stated the errand moves the call forward instead of re-asking.
  const goalStated = ctx.history.some((h) => h.role === "agent" && /^jeg vil gjerne|^jeg ringer på vegne av/i.test(h.text));
  const assent = !c.includes("?") && /det går (helt )?(bra|fint)|^(ja|jada|javisst|greit|ok|okei|fint|supert|absolutt|det kan vi)\b/.test(c);
  if (goalStated && assent) {
    const askedDetails = ctx.history.some((h) => h.role === "agent" && /hva koster det/i.test(h.text));
    if (!askedDetails) return "Flott! Hva koster det, og når er det klart?";
    return "Supert, tusen takk for hjelpen. Ha det bra! [[END: partial | Mottakeren sa ja, men pris og tid ble ikke bekreftet.]]";
  }
  if (/navn(et)?|hvem (er det|skal)|på hvem/.test(c)) return `Den står på ${name}.`;
  if (/allerg/.test(c)) return ctx.profileFacts.allergies ? `Ja: ${ctx.profileFacts.allergies}.` : "Nei, ingen allergier.";
  if (/det går (bra|fint)|^(ja|jada|javisst|greit|ok|okei|sure)\b|hva skal det være|hva kan jeg (hjelpe|gjøre)|hvordan kan jeg hjelpe|hva gjelder|hva (vil|ønsker) du|ja\??$|^hei|hallo|værsågod|det går fint|ok/.test(c)) {
    return `Jeg vil gjerne ${ctx.goal}.`;
  }
  if (/vent|et øyeblikk|ett øyeblikk|sekund/.test(c)) return "Ja, jeg venter.";
  // Anything that isn't a no after the opening counts as "go ahead": state the errand.
  const goalSaid = ctx.history.some((h) => h.role === "agent" && h.text.startsWith("Jeg vil gjerne"));
  if (!goalSaid) return `Jeg vil gjerne ${ctx.goal}.`;
  // Ask to repeat once; after that, steer back instead of looping.
  const lastAgent = lastOf(ctx, "agent");
  if (/si det en gang til/.test(lastAgent)) return `Takk. For å oppsummere: jeg vil gjerne ${ctx.goal}. Går det an?`;
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
