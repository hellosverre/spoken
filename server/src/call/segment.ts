// Splits a streaming LLM reply into speakable sentences and [[TAG: …]] directives,
// so the first sentence can go to TTS while the model is still writing the rest.

export type Segment =
  | { kind: "speech"; text: string }
  | { kind: "ask"; question: string; options: string[] }
  | { kind: "end"; outcome: string; summary: string }
  | { kind: "note"; text: string };

export function parseTag(body: string): Segment | null {
  const m = body.match(/^\s*(ASK|END|NOTE)\s*:\s*([\s\S]*)$/i);
  if (!m) return null;
  const parts = m[2]!.split("|").map((s) => s.trim()).filter(Boolean);
  const tag = m[1]!.toUpperCase();
  if (tag === "ASK") {
    const options = parts.slice(1);
    return { kind: "ask", question: parts[0] ?? "", options: options.length ? options : ["JA", "NEI"] };
  }
  if (tag === "END") return { kind: "end", outcome: parts[0] ?? "partial", summary: parts.slice(1).join(" | ") };
  return { kind: "note", text: parts.join(" | ") };
}

export class Segmenter {
  private buf = "";
  private spoke = false;

  /**
   * firstClause: let the first speech segment end at a comma, so TTS can start on
   * "Ja, takk," while the model is still writing. Later segments stay whole sentences.
   */
  constructor(private firstClause = false) {}

  /** Feed a token; returns any segments that are complete. */
  push(tok: string): Segment[] {
    this.buf += tok;
    return this.drain(false);
  }

  /** Stream ended: flush whatever is left. */
  end(): Segment[] {
    return this.drain(true);
  }

  private drain(final: boolean): Segment[] {
    const out: Segment[] = [];
    while (this.buf.length) {
      const tagStart = this.buf.indexOf("[[");
      // Text before a tag is its own sentence.
      const sentEnd = this.findSentenceEnd(tagStart >= 0 ? this.buf.slice(0, tagStart) : this.buf, final || tagStart >= 0);
      if (sentEnd > 0) {
        const s = this.buf.slice(0, sentEnd).trim();
        this.buf = this.buf.slice(sentEnd);
        if (s) { out.push({ kind: "speech", text: s }); this.spoke = true; }
        continue;
      }
      if (tagStart === 0 || (tagStart > 0 && !this.buf.slice(0, tagStart).trim())) {
        const close = this.buf.indexOf("]]", tagStart);
        if (close < 0) { if (final) this.buf = ""; break; }
        const seg = parseTag(this.buf.slice(tagStart + 2, close));
        this.buf = this.buf.slice(close + 2);
        if (seg) out.push(seg);
        continue;
      }
      break;
    }
    return out;
  }

  /** Index just past the first sentence end, or 0. With `flush`, the whole text counts. */
  private findSentenceEnd(text: string, flush: boolean): number {
    const re = /[.!?…](?=\s)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const before = text.slice(0, m.index);
      if (m[0] === "." && /\b(kl|ca|nr|evt|bl\.a|f\.eks|ca)$/i.test(before)) continue;
      if (before.trim().length >= 2) return m.index + 1;
    }
    if (this.firstClause && !this.spoke) {
      const c = /[,;:](?=\s)/.exec(text);
      if (c) {
        const before = text.slice(0, c.index).trim();
        if (before.length >= 10 && before.split(/\s+/).length >= 2) return c.index + 1;
      }
    }
    return flush && text.trim() ? text.length : 0;
  }
}
