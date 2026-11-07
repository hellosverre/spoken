// "They put US on hold" detector (hold.ts is the opposite: us asking THEM to hold).
// Phrase-based: the callee says «et øyeblikk / vent litt / jeg setter deg på vent / hold on».
// While on hold the agent stays silent; speech that looks like a person addressing us ends it.

export const HOLD_PHRASE = /\b(et (lite )?øyeblikk|ett (lite )?øyeblikk|vent litt|et sekund|ett sekund|vent et øyeblikk|vennligst vent|jeg setter (deg|dere) på vent|setter deg over|jeg kobler deg|hold (on|the line)|one (moment|second|sec)|just a (moment|second|sec|minute)|please hold|bear with me|let me (just )?(check|transfer|put you)|stor (pågang|trafikk)|takk for at du venter|du er nummer \d+|alle (våre )?(medarbeidere|linjer|operatører) er opptatt|(vi )?(vil )?hjelpe deg så snart|samtalen (din )?er viktig|your call is important|all (of )?our (agents|lines|operators) are (busy|currently)|you are (caller )?number \d+|high (call )?volume)\b/i;

// A person is back: greeting, apology for the wait, or asking if we're there.
const BACK = /\b(hei|hallo|halla|takk for (at du ventet|ventetiden)|beklager (ventetiden|at du)|der igjen|er du der|der er du|hello|hi there|thanks for (waiting|holding)|sorry for the wait|are you (still )?there|thank you for holding)\b/i;

/** Ignore the tail of the hold phrase itself and the first music transcriptions. */
const GRACE_MS = 1500;
/** Long unrelated speech while "on hold" is most likely a person, not music lyrics. */
const LONG_WORDS = 6;

export interface OnHoldDeps {
  onHold(since: number): void;
  holdOver(): void;
  now?: () => number;
}

export class OnHoldDetector {
  private since = 0;

  constructor(private d: OnHoldDeps) {}

  get active() { return this.since > 0; }

  private now() { return this.d.now?.() ?? Date.now(); }

  /**
   * Feed every final callee line. Returns true when the line belongs to the hold
   * (the hold phrase itself, or chatter during the hold): the agent must not answer it.
   */
  onCallee(text: string): boolean {
    const t = text.replace(/\s*⟨.*?⟩/g, "").trim();
    if (!t) return false;
    if (!this.active) {
      // A real question after the phrase («Et øyeblikk, hva heter du?») still needs an answer.
      if (HOLD_PHRASE.test(t) && !/\?/.test(t) && t.split(/\s+/).length <= 10) {
        this.since = this.now();
        this.d.onHold(this.since);
        return true;
      }
      return false;
    }
    if (this.now() - this.since < GRACE_MS) return true;
    if (BACK.test(t) || t.split(/\s+/).length >= LONG_WORDS) {
      this.end();
      return false; // a person: the agent answers this line
    }
    return true;
  }

  /** Call ended or the user hung up. */
  end() {
    if (!this.active) return;
    this.since = 0;
    this.d.holdOver();
  }
}
