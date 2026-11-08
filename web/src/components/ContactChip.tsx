"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { api, getToken } from "@/lib/account";
import { toE164 } from "@/lib/phone";
import { useSpoken } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { VoiceSheet } from "./VoiceSheet";
import { Field } from "./ui";
import type { SavedContact } from "./ContactPicker";

/* Contacts inside the chat: a typed number becomes a «save as contact» chip, and typing a saved
   name offers the contact. The list is cached per login and refreshed after every add. */

const COPY = {
  no: {
    save: (n: string) => `Lagre ${n} som kontakt`,
    sheetT: "Lagre kontakt", nameL: "Navn", namePh: "f.eks. Melvin", numberL: "Nummer",
    saveBtn: "Lagre", close: "Avbryt", failed: "Kunne ikke lagre. Prøv igjen.", saved: (n: string) => `${n} lagret`,
    suggest: "Foreslåtte kontakter", insert: (n: string) => `Sett inn ${n}`,
  },
  en: {
    save: (n: string) => `Save ${n} as a contact`,
    sheetT: "Save contact", nameL: "Name", namePh: "e.g. Melvin", numberL: "Number",
    saveBtn: "Save", close: "Cancel", failed: "Couldn't save. Try again.", saved: (n: string) => `${n} saved`,
    suggest: "Suggested contacts", insert: (n: string) => `Insert ${n}`,
  },
} as const;

// ---- pure helpers (mirrored in mobile/src/components/ContactChip.tsx) ----

/** «+4791909007» → «+47 919 09 007». Other countries: plain digits after the code. */
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+47(\d{3})(\d{2})(\d{3})$/);
  return m ? `+47 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

const NUMBER_RE = /(?:\+|00)?\d[\d ()-]{6,18}\d/g;
const NOT_NAMES = new Set(["ring", "ringe", "call", "hei", "hi", "hello", "kan", "can", "please", "vær", "snill", "til", "to", "for", "på", "nummer", "number", "tlf", "telefon", "phone", "min", "my", "mitt"]);

/** The first dialable number in `text` that is not already saved, with a name guessed from the words beside it. */
export function findNumber(text: string, saved: readonly { phone: string }[]): { e164: string; name: string } | null {
  const have = new Set(saved.map((c) => c.phone));
  for (const m of text.matchAll(NUMBER_RE)) {
    const e164 = toE164(m[0].trim());
    if (!e164 || have.has(e164)) continue;
    const word = (w: string | undefined) => (w && /^[A-ZÆØÅ][\p{L}'-]+$/u.test(w) && !NOT_NAMES.has(w.toLowerCase()) ? w : "");
    const before = text.slice(0, m.index).trimEnd().replace(/[:,(\-–]+$/, "").trimEnd().split(/\s+/).pop();
    const after = text.slice((m.index ?? 0) + m[0].length).trimStart().replace(/^[(\-–,:]+\s*/, "").split(/\s+/)[0]?.replace(/[.,!?)]+$/, "");
    return { e164, name: word(before) || word(after) };
  }
  return null;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Up to 3 saved contacts whose name starts with the word being typed (≥2 letters, case- and accent-blind). */
export function suggestFor(draft: string, contacts: readonly SavedContact[]): { contacts: SavedContact[]; word: string } {
  const word = draft.match(/([\p{L}'-]{2,})$/u)?.[1] ?? "";
  if (!word) return { contacts: [], word };
  const q = fold(word);
  const hits = contacts.filter((c) => fold(c.name).split(/\s+/).some((p) => p.startsWith(q)));
  return { contacts: hits.slice(0, 3), word };
}

/** What a tapped suggestion puts into the draft in place of the typed word. */
export const insertion = (c: { name: string; phone: string }) => `${c.name} (${formatPhone(c.phone)})`;

// ---- contact cache (per login) ----

let cache: { token: string; items: SavedContact[] } | null = null;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function refresh(): Promise<void> {
  const token = getToken();
  if (!token) return Promise.resolve();
  inflight ??= api<SavedContact[]>("GET", "/api/contacts")
    .then((items) => { cache = { token, items }; }, () => { cache ??= { token, items: [] }; })
    .finally(() => { inflight = null; emit(); });
  return inflight;
}

export function useSavedContacts(): SavedContact[] {
  const items = useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => (cache && cache.token === getToken() ? cache.items : EMPTY),
    () => EMPTY,
  );
  useEffect(() => { if (!cache || cache.token !== getToken()) void refresh(); }, []);
  return items;
}
const EMPTY: SavedContact[] = [];

async function addContact(name: string, phone: string): Promise<void> {
  await api<SavedContact>("POST", "/api/contacts", { name, phone, kind: "person" });
  await refresh();
}

// ---- UI ----

/** Chip under the draft: «Lagre +47 919 09 007 som kontakt» → name sheet → POST /api/contacts. */
export function SaveContactChip({ draft }: { draft: string }) {
  const lang = useSpoken((s) => s.lang);
  const c = COPY[lang];
  const contacts = useSavedContacts();
  const found = findNumber(draft, contacts);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  if (!found && !note) return null;
  if (!found) return <p className="cc-note" role="status">{note}</p>;
  const shown = formatPhone(found.e164);

  async function submit() {
    if (!found || busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await addContact(name.trim().slice(0, 80), found.e164);
      setOpen(false);
      setNote(c.saved(name.trim()));
      setTimeout(() => setNote(""), 3000);
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="cc-chip" onClick={() => { setName(found.name); setError(""); setOpen(true); }}>
        <Icon name="plus" />
        {c.save(shown)}
      </button>
      {open && (
        <VoiceSheet title={c.sheetT} closeLabel={c.close} onClose={() => setOpen(false)}>
          <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <Field label={c.nameL} placeholder={c.namePh} value={name} maxLength={80} autoComplete="off" autoFocus onChange={(e) => setName(e.target.value)} />
            <p className="help">{c.numberL}: {shown}</p>
            {error && <p className="help" role="alert">{error}</p>}
            <button type="submit" className="btn primary block tall" disabled={busy || !name.trim()}>{c.saveBtn}</button>
          </form>
        </VoiceSheet>
      )}
    </>
  );
}

/** Up to 3 saved contacts matching the word being typed; a tap swaps the word for «Name (+47 …)». */
export function ContactSuggestions({ draft, onPick }: { draft: string; onPick(next: string): void }) {
  const lang = useSpoken((s) => s.lang);
  const c = COPY[lang];
  const contacts = useSavedContacts();
  const { contacts: hits, word } = suggestFor(draft, contacts);
  if (!hits.length) return null;
  return (
    <div className="cc-row" role="group" aria-label={c.suggest}>
      {hits.map((x) => (
        <button key={x.id} type="button" className="cc-chip" aria-label={c.insert(`${x.name} ${formatPhone(x.phone)}`)}
          onMouseDown={(e) => e.preventDefault()} // keep the keyboard / caret in the field
          onClick={() => onPick(draft.slice(0, draft.length - word.length) + insertion(x) + " ")}>
          <Icon name="person" />
          {x.name}
          <span>{formatPhone(x.phone)}</span>
        </button>
      ))}
    </div>
  );
}

export const CONTACT_CHIP_CSS = `
.cc-row{display:flex;gap:0.375rem;overflow-x:auto;padding-bottom:0.5rem;scrollbar-width:none}
.cc-chip{flex:none;display:inline-flex;align-items:center;gap:0.4375rem;min-height:2rem;padding:0 0.75rem;margin-bottom:0.5rem;border-radius:62.4375rem;border:1px solid var(--line-2);background:var(--surface);color:var(--ink);font:inherit;font-size:0.8125rem;cursor:pointer;max-width:100%}
.cc-row .cc-chip{margin-bottom:0}
.cc-chip:hover{border-color:var(--accent)}
.cc-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cc-chip svg.i{width:0.9375rem;height:0.9375rem;color:var(--accent);flex:none}
.cc-chip span{color:var(--muted)}
.cc-note{margin:0 0 0.5rem;font-size:0.8125rem;color:var(--muted)}
`;
