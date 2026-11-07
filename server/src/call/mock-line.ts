// Fake phone line with a scripted Norwegian pizza-shop callee. No keys, no audio:
// it reacts to what the agent says and paces itself like a real call.

import type { Word } from "../../../shared/contract.ts";
import type { CallLine, LineEvents, SpeakKind } from "./line.ts";

const SCRIPT = {
  greet: "Hei, du har kommet til Domino's Storo. Det går helt fint. Hva kan jeg hjelpe deg med?",
  price: "En stor pepperoni til henting klokka 18:00, det blir 189 kroner. Skal jeg legge inn bestillingen?",
  card: "Flott! Kan jeg få kortnummeret ditt, så betaler vi med en gang?",
  name: "Ja da, du kan betale når du henter. Hvilket navn skal bestillingen stå på?",
  bye: "Supert, den er klar klokka 18:00. Ha det bra!",
  declined: "Den er grei. Ha det!",
  repeat: "Hæ? Unnskyld, hva sa du?",
};

// Words the fake STT is "unsure" about, so the UI can grey them out.
const UNSURE = new Set(["Storo.", "Storo", "pepperoni", "189"]);

export class MockLine implements CallLine {
  private ev!: LineEvents;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopSpeak?: () => void;
  private stage: keyof typeof SCRIPT | "start" = "start";
  private seg = 0;
  private closed = false;
  waitingSound: false | "typing" | "music" = false;

  /** speed 1 ≈ real time; tests use ~0.02. */
  constructor(private speed = 1) {}

  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => { this.timers.delete(t); resolve(); }, ms * this.speed);
      this.timers.add(t);
    });
  }

  async start(events: LineEvents) {
    this.ev = events;
    void (async () => {
      await this.wait(600);
      if (this.closed) return;
      events.status("ringing");
      await this.wait(1800);
      if (this.closed) return;
      events.status("connected");
    })();
  }

  /** Fake voice loudness at ~15 Hz while someone "talks", so the live visual works in mock mode. */
  private pulse(who: "callee" | "agent", ms: number) {
    let t = 0;
    const iv = setInterval(() => {
      t += 66;
      if (this.closed || t >= ms) { clearInterval(iv); this.ev.level?.(who, 0); return; }
      const v = 0.35 + 0.3 * Math.abs(Math.sin(t / 140)) + 0.15 * Math.sin(t / 47);
      this.ev.level?.(who, Math.round(Math.max(0.05, Math.min(1, v)) * 100) / 100);
    }, 66);
  }

  async speak(text: string, kind: SpeakKind) {
    // No audio in mock: "audio starts" when speaking starts. STT/TTS figures stay null.
    if (kind === "say") this.ev.metric?.({ kind: "first_audio", at: Date.now() });
    const words = text.split(/\s+/).length;
    this.pulse("agent", words * 260 * this.speed);
    const done = new Promise<{ interrupted: boolean }>((resolve) => {
      const t = setTimeout(() => { this.timers.delete(t); this.stopSpeak = undefined; resolve({ interrupted: false }); }, words * 260 * this.speed);
      this.timers.add(t);
      this.stopSpeak = () => { clearTimeout(t); this.timers.delete(t); this.stopSpeak = undefined; resolve({ interrupted: true }); };
    });
    const r = await done;
    if (!r.interrupted && kind === "say" && !this.closed) void this.respondTo(text);
    return r;
  }

  stopSpeaking() { this.stopSpeak?.(); }
  startWaitingSound(kind: "typing" | "music" = "typing") { this.waitingSound = kind; }
  stopWaitingSound() { this.waitingSound = false; }

  async hangup() {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private next(agentText: string): keyof typeof SCRIPT | null {
    const a = agentText.toLowerCase();
    if (/nei takk|lar vi det være|avslutte/.test(a)) return "declined";
    if (/ha det/.test(a)) return null;
    if (/ki-assistent/.test(a) && this.stage === "start") return "greet";
    if (/jeg vil gjerne|bestille/.test(a) && (this.stage === "greet" || this.stage === "repeat")) return "price";
    if (/bekrefter|ja takk/.test(a) && this.stage === "price") return "card";
    if (/kortnummer|betale ved henting|betalingslenke/.test(a) && this.stage === "card") return "name";
    if (/står på|navnet er/.test(a) && this.stage === "name") return "bye";
    if (/si det en gang til|gjenta/.test(a)) return this.stage === "start" ? "greet" : (this.stage as keyof typeof SCRIPT);
    return null;
  }

  private async respondTo(agentText: string) {
    const step = this.next(agentText);
    if (!step) return;
    this.stage = step;
    await this.wait(700);
    if (this.closed) return;
    await this.talk(SCRIPT[step]);
  }

  /** Streams a callee line as partials, then a final with word confidences. */
  async talk(text: string) {
    const id = `c_${++this.seg}`;
    const parts = text.split(" ");
    this.ev.calleeSpeech();
    this.pulse("callee", (Math.ceil(parts.length / 3) * 330 + 250) * this.speed);
    for (let i = 1; i <= parts.length; i += 3) {
      await this.wait(330);
      if (this.closed) return;
      this.ev.calleePartial(id, parts.slice(0, i).join(" "));
    }
    await this.wait(250);
    if (this.closed) return;
    const words: Word[] = parts.map((w) => ({ text: w, confidence: UNSURE.has(w) ? 0.52 : 0.93 }));
    this.ev.calleeFinal(id, text, words);
  }
}
