"use client";

import { useState } from "react";
import { sendFeedback } from "@/lib/real-call";
import { cx, useAppCopy } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { Field, HeadButton, PageSheet } from "./ui";

type Rating = "up" | "down";

/**
 * "Did it go well?" under the call result. A tap on a thumb is sent at once (so a rating
 * is never lost if the sheet is closed), then an optional note can follow.
 */
export function CallFeedback() {
  const m = useAppCopy();
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function rate(r: Rating) {
    if (busy) return;
    setRating(r);
    setFailed(false);
    // A failed rating is not worth interrupting the user; the note still carries it.
    sendFeedback({ source: "call", rating: r }).catch(() => {});
  }

  async function submit() {
    if (!rating || busy) return;
    const text = comment.trim();
    if (!text) return setDone(true);
    setBusy(true);
    try {
      await sendFeedback({ source: "call", rating, comment: text });
      setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="fb-thanks" role="status">
        <Icon name="check" />
        {m.fbThanks}
      </p>
    );
  }

  return (
    <div className="fb">
      <div className="fb-ask">
        <b id="fbAsk">{m.fbAsk}</b>
        <div className="fb-thumbs" role="group" aria-labelledby="fbAsk">
          <button type="button" className="thumb" aria-pressed={rating === "up"} aria-label={m.fbUp} onClick={() => rate("up")}>
            <Icon name="thumbUp" />
          </button>
          <button type="button" className="thumb" aria-pressed={rating === "down"} aria-label={m.fbDown} onClick={() => rate("down")}>
            <Icon name="thumbDown" />
          </button>
        </div>
      </div>
      {rating && (
        <>
          <div className="fb-send">
            <textarea
              className="input multi"
              rows={1}
              maxLength={1000}
              value={comment}
              placeholder={m.fbCommentPh}
              aria-label={m.fbCommentPh}
              onChange={(e) => setComment(e.target.value)}
            />
            <button type="button" className={cx("btn primary")} disabled={busy} onClick={submit}>
              {m.fbSend}
            </button>
          </div>
          {failed && <p className="bad-msg">{m.fbFail}</p>}
        </>
      )}
    </div>
  );
}

/** Profile → "Send feedback": a short note in a page sheet. */
export function FeedbackSheet({ onClose }: { onClose(): void }) {
  const m = useAppCopy();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = text.trim().length > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await sendFeedback({ source: "profile", comment: text.trim() });
      setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageSheet
      title={m.fbH}
      left={<HeadButton label={m.cancel} onClick={onClose} />}
      right={done ? <HeadButton strong label={m.done} onClick={onClose} /> : <HeadButton strong label={busy ? "…" : m.fbSend} onClick={submit} />}
      onClose={onClose}
    >
      {done ? (
        <p className="fb-thanks" role="status">
          <Icon name="check" />
          {m.fbThanks}
        </p>
      ) : (
        <div className="sheet-form">
          <Field
            multiline
            label={m.fbH}
            placeholder={m.fbPh}
            help={m.fbHelp}
            rows={5}
            maxLength={1000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={failed}
          />
          {failed && <p className="bad-msg">{m.fbFail}</p>}
        </div>
      )}
    </PageSheet>
  );
}
