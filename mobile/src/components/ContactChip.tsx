import { useEffect, useSyncExternalStore, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { api, hasSession } from "../lib/account";
import { F, makeStyles, useTheme } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";
import type { SavedContact } from "./ContactPicker";
import { Icon } from "./Icon";
import { toE164 } from "./phone";
import { Btn, Field, Press } from "./ui";
import { VoiceSheet } from "./VoiceSheet";

/* Contacts inside the chat (mirror of web/src/components/ContactChip.tsx): a typed number becomes a
   «save as contact» chip, and typing a saved name offers the contact. Cached per session, refreshed
   after every add. */

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

/** «+4791909007» → «+47 919 09 007». */
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
  return { contacts: contacts.filter((c) => fold(c.name).split(/\s+/).some((p) => p.startsWith(q))).slice(0, 3), word };
}

export const insertion = (c: { name: string; phone: string }) => `${c.name} (${formatPhone(c.phone)})`;

// ---- contact cache ----

let cache: SavedContact[] | null = null;
let inflight: Promise<void> | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const EMPTY: SavedContact[] = [];

/** Forget the cache (logout / account deletion), so the next account never sees these contacts. */
export function resetContactCache() {
  cache = null;
  emit();
}

function refresh(): Promise<void> {
  inflight ??= hasSession()
    .then((ok) => (ok ? api<SavedContact[]>("GET", "/api/contacts").then((items) => { cache = items; }) : undefined))
    .catch(() => { cache ??= []; })
    .finally(() => { inflight = null; emit(); });
  return inflight;
}

export function useSavedContacts(): SavedContact[] {
  const items = useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => cache ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => { if (!cache) void refresh(); }, []);
  return items;
}

async function addContact(name: string, phone: string) {
  await api("POST", "/api/contacts", { name, phone, kind: "person" });
  await refresh();
}

// ---- UI ----

/** Chip under the draft: «Lagre +47 919 09 007 som kontakt» → name sheet → POST /api/contacts. */
export function SaveContactChip({ draft }: { draft: string }) {
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const c = COPY[lang];
  const contacts = useSavedContacts();
  const found = findNumber(draft, contacts);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(""), 3000);
    return () => clearTimeout(id);
  }, [note]);

  if (!found && !note) return null;
  if (!found) return <Text style={styles.note} accessibilityRole="alert">{note}</Text>;
  const shown = formatPhone(found.e164);

  async function submit() {
    if (!found || busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await addContact(name.trim().slice(0, 80), found.e164);
      setOpen(false);
      setNote(c.saved(name.trim()));
    } catch {
      setError(c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Press accessibilityLabel={c.save(shown)} onPress={() => { setName(found.name); setError(""); setOpen(true); }} style={[styles.chip, styles.alone]}>
        <Icon name="plus" color={C.accent} size={14} />
        <Text style={styles.chipText}>{c.save(shown)}</Text>
      </Press>
      <VoiceSheet visible={open} title={c.sheetT} closeLabel={c.close} onClose={() => setOpen(false)}>
        <Field label={c.nameL} placeholder={c.namePh} value={name} onChangeText={setName} maxLength={80} autoFocus autoComplete="off" returnKeyType="done" onSubmitEditing={() => void submit()} />
        <Text style={styles.note}>{c.numberL}: {shown}</Text>
        {error ? <Text style={styles.err} accessibilityRole="alert">{error}</Text> : null}
        <Btn block label={c.saveBtn} disabled={busy || !name.trim()} onPress={() => void submit()} />
      </VoiceSheet>
    </>
  );
}

/** Up to 3 saved contacts matching the word being typed; a tap swaps the word for «Name (+47 …)». */
export function ContactSuggestions({ draft, onPick }: { draft: string; onPick(next: string): void }) {
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const c = COPY[lang];
  const contacts = useSavedContacts();
  const { contacts: hits, word } = suggestFor(draft, contacts);
  if (!hits.length) return null;
  return (
    <View accessibilityLabel={c.suggest}>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {hits.map((x) => (
          <Press key={x.id} accessibilityLabel={c.insert(`${x.name} ${formatPhone(x.phone)}`)} onPress={() => onPick(draft.slice(0, draft.length - word.length) + insertion(x) + " ")} style={styles.chip}>
            <Icon name="person" color={C.accent} size={14} />
            <Text style={styles.chipText}>{x.name}</Text>
            <Text style={styles.chipSub}>{formatPhone(x.phone)}</Text>
          </Press>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  row: { gap: 6, paddingBottom: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface },
  alone: { alignSelf: "flex-start", marginBottom: 8 },
  chipText: { fontFamily: F.regular, fontSize: 13, color: C.ink },
  chipSub: { fontFamily: F.regular, fontSize: 13, color: C.dim },
  note: { fontFamily: F.regular, fontSize: 13, color: C.dim, marginBottom: 8 },
  err: { fontFamily: F.regular, fontSize: 13, color: C.danger, marginBottom: 8 },
}));
