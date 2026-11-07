// What happens on the line while the user hasn't answered an approval card:
// 30 s → ask the callee to hold; yes → soft hold music with a reminder every 20 s;
// no, or 2 min in total → offer to call back and end the call. The user answering
// at any point stops the music and the call continues.

import { config } from "../config.ts";
import { UI_TEXT, type UiText } from "./ui-text.ts";
import { LINES, type Lines } from "./lines.ts";

export const HOLD_LINES = LINES.no.hold;

// Note texts the web app matches on (agreed with Form): countdown via /(\d+)\s*s/.
export const HOLD_NOTES = UI_TEXT.no.hold;

const NO = /^(nei|nope|no)\b|kan ikke|har ikke tid|ikke mulighet|dessverre|må gå|må stikke|travelt|ring(e)? (meg )?(tilbake|senere|igjen)|can't|cannot|don't have time|no time|have to go|gotta go|too busy|call (me )?(back|later|again)/i;

export interface HoldDeps {
  userName: string;
  /** The hold lines in the call's current language (default Norwegian). */
  lines?: () => Lines["hold"];
  /** The notes in the app language (default Norwegian). */
  notes?: () => UiText["hold"];
  say(text: string): Promise<unknown>;
  note(text: string, level?: "info" | "warn"): void;
  sound(kind: "typing" | "music" | "off"): void;
  /** Ends the call as partial after the callback line. */
  giveUp(summary: string): Promise<void>;
  debug(kind: string, data?: Record<string, unknown>): void;
}

type State = "idle" | "waiting" | "asking" | "holding" | "done";

export class HoldFlow {
  private state: State = "idle";
  private since = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private remindTimer?: ReturnType<typeof setInterval>;

  constructor(private d: HoldDeps) {}

  private get L() { return this.d.lines?.() ?? HOLD_LINES; }
  private get N() { return this.d.notes?.() ?? HOLD_NOTES; }

  get active() { return this.state === "asking" || this.state === "holding"; }

  private secondsLeft() {
    return Math.max(0, Math.round((this.since + config.holdMaxSec * 1000 - Date.now()) / 1000));
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    clearInterval(this.remindTimer);
    this.remindTimer = undefined;
  }

  /** An approval card just went out. */
  arm() {
    this.clear();
    this.state = "waiting";
    this.since = Date.now();
    this.timers.push(setTimeout(() => void this.ask(), config.holdAskSec * 1000));
    this.timers.push(setTimeout(() => void this.callback("approval timeout"), config.holdMaxSec * 1000));
  }

  private async ask() {
    if (this.state !== "waiting") return;
    this.state = "asking";
    this.d.debug("hold_ask");
    this.d.sound("off");
    this.d.note(this.N.asking);
    await this.d.say(this.L.ask(this.d.userName || (this.L === LINES.en.hold ? LINES.en.user : LINES.no.user)));
    // No answer from the callee within 10 s: they're still there, so start the hold.
    this.timers.push(setTimeout(() => { if (this.state === "asking") void this.startHold(); }, 10_000));
  }

  /** Callee spoke while we wait. Returns true if the hold flow handled it. */
  onCallee(text: string): boolean {
    if (this.state === "asking") {
      if (NO.test(text.trim())) void this.callback("callee declined to hold");
      else void this.startHold();
      return true;
    }
    if (this.state === "holding") {
      void (async () => {
        this.d.sound("off");
        await this.d.say(this.L.stillHere);
        if (this.state === "holding") this.d.sound("music");
      })();
      return true;
    }
    return false;
  }

  private async startHold() {
    if (this.state !== "asking") return;
    this.state = "holding";
    this.d.debug("hold_start");
    await this.d.say(this.L.thanks);
    if (this.state !== "holding") return;
    this.d.sound("music");
    this.d.note(this.N.holding(this.secondsLeft()));
    this.remindTimer = setInterval(() => void this.remind(), config.holdRemindSec * 1000);
  }

  private async remind() {
    if (this.state !== "holding") return;
    this.d.sound("off");
    await this.d.say(this.L.remind);
    if (this.state !== "holding") return;
    this.d.sound("music");
    this.d.note(this.N.remind(this.secondsLeft()));
  }

  private async callback(why: string) {
    if (this.state === "done" || this.state === "idle") return;
    this.state = "done";
    this.clear();
    this.d.debug("hold_callback", { why });
    this.d.sound("off");
    this.d.note(this.N.callback, "warn");
    await this.d.say(this.L.callback);
    await this.d.giveUp("Personen kunne ikke vente på svaret ditt; Spoken tilbød å ringe tilbake senere.");
  }

  /** The user answered the card. Says thanks first if the callee was asked to hold. */
  async resume(): Promise<void> {
    const wasHolding = this.active;
    this.clear();
    this.state = "idle";
    if (!wasHolding) return;
    this.d.debug("hold_resume");
    this.d.sound("off");
    this.d.note(this.N.resumed);
    await this.d.say(this.L.back);
  }

  cancel() {
    this.clear();
    this.state = "done";
  }
}
