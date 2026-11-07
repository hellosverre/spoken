"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/account";
import { e164List } from "@/lib/phone";
import { useSpoken } from "@/lib/use-spoken";
import { Icon } from "./Icon";

/* Phone contacts on the web: the Contact Picker API (Android Chrome). iOS Safari has none,
   so the entry points hide themselves there and the manual fields stay. Picked contacts are
   saved to the per-device /api/contacts the server already has. Nothing is read until the
   user taps and chooses in the browser's own picker. */

interface PickedContact {
  name?: string[];
  tel?: string[];
}
interface ContactsApi {
  select(props: string[], opts?: { multiple?: boolean }): Promise<PickedContact[]>;
}
export interface SavedContact {
  id: string;
  name: string;
  phone: string;
  kind: "business" | "person";
}
export interface Picked {
  name: string;
  phone: string;
}

const COPY = {
  en: {
    pick: "Pick from contacts",
    pickShort: "Contacts",
    importT: "Import from phone",
    importS: "Choose people from your phone book",
    saved: "Saved contacts",
    none: "No saved contacts yet.",
    added: (n: number) => `${n} added`,
    nothing: "Nothing added: no usable phone numbers.",
    failed: "Could not save the contacts. Try again.",
    remove: (n: string) => `Remove ${n}`,
  },
  no: {
    pick: "Velg fra kontakter",
    pickShort: "Kontakter",
    importT: "Importer fra telefonen",
    importS: "Velg folk fra telefonboka",
    saved: "Lagrede kontakter",
    none: "Ingen lagrede kontakter ennå.",
    added: (n: number) => `${n} lagt til`,
    nothing: "Ingen lagt til: fant ingen brukbare telefonnumre.",
    failed: "Kunne ikke lagre kontaktene. Prøv igjen.",
    remove: (n: string) => `Fjern ${n}`,
  },
} as const;

export function useContactCopy() {
  return COPY[useSpoken((s) => s.lang)];
}

/** True where the browser has the Contact Picker API (checked after mount: SSR has no navigator). */
export function useContactPicker(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setOk(typeof navigator !== "undefined" && "contacts" in navigator && typeof (navigator as { contacts?: ContactsApi }).contacts?.select === "function");
  }, []);
  return ok;
}

/* ---- server (device + account token headers live in lib/account.ts) ---- */

export const listSaved = () => api<SavedContact[]>("GET", "/api/contacts");
export const removeSaved = (id: string) => api<{ ok: true }>("DELETE", `/api/contacts/${id}`);

/** Save picked people; numbers already saved are skipped. Returns what is new. */
export async function saveContacts(picked: Picked[]): Promise<SavedContact[]> {
  const have = new Set((await listSaved()).map((c) => c.phone));
  const added: SavedContact[] = [];
  for (const p of picked) {
    if (have.has(p.phone)) continue;
    have.add(p.phone);
    added.push(await api<SavedContact>("POST", "/api/contacts", { name: p.name, phone: p.phone, kind: "person" }));
  }
  return added;
}

/** Opens the browser's picker (must run from a tap). [] = cancelled or nothing usable. */
export async function pickFromPhone(multiple: boolean): Promise<Picked[]> {
  const contacts = (navigator as { contacts?: ContactsApi }).contacts;
  if (!contacts) return [];
  let raw: PickedContact[];
  try {
    raw = await contacts.select(["name", "tel"], { multiple });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "AbortError" || e.name === "NotAllowedError")) return [];
    throw e;
  }
  const out: Picked[] = [];
  for (const c of raw) {
    const name = (c.name?.[0] ?? "").trim();
    for (const phone of e164List(c.tel ?? [])) out.push({ name: name || phone, phone });
  }
  return out;
}

/* ---- Composer button ---- */

/** Small outlined contacts button for the chat field. Inserts "Name +47…" into the request. */
export function ContactsButton({ onInsert }: { onInsert(text: string): void }) {
  const supported = useContactPicker();
  const c = useContactCopy();
  if (!supported) return null;
  return (
    <button
      type="button"
      className="send"
      style={{ background: "transparent", color: "var(--ink)", border: "1px solid var(--line)" }}
      aria-label={c.pick}
      title={c.pick}
      onClick={async () => {
        try {
          const [first] = await pickFromPhone(false);
          if (!first) return;
          onInsert(`${first.name} ${first.phone}`);
          saveContacts([first]).catch(() => {});
        } catch {
          /* the picker failing is not worth interrupting the request */
        }
      }}
    >
      <Icon name="person" />
    </button>
  );
}

/* ---- Profile section ---- */

/** Profile → Contacts: "Import from phone" (when supported) and the saved list. */
export function ContactsSection() {
  const supported = useContactPicker();
  const c = useContactCopy();
  const [items, setItems] = useState<SavedContact[] | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listSaved().then(setItems, () => setItems((x) => x ?? []));
  }, []);
  useEffect(load, [load]);

  async function runImport() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      const picked = await pickFromPhone(true);
      if (!picked.length) return;
      const added = await saveContacts(picked);
      setMsg(added.length ? c.added(added.length) : c.nothing);
      load();
    } catch {
      setMsg(c.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="list">
        {supported && (
          <li>
            <button className="row" onClick={runImport} disabled={busy}>
              <span className="ic">
                <Icon name="plus" />
              </span>
              <span className="tx">
                <b>{c.importT}</b>
                <span>{c.importS}</span>
              </span>
              <span className="go">
                <Icon name="chevron" />
              </span>
            </button>
          </li>
        )}
        {(items ?? []).map((x) => (
          <li key={x.id} className="row static">
            <span className="ic">
              <Icon name="person" />
            </span>
            <span className="tx">
              <b>{x.name}</b>
              <span>{x.phone}</span>
            </span>
            <button
              type="button"
              className="headbtn"
              aria-label={c.remove(x.name)}
              onClick={() => {
                removeSaved(x.id).then(load, () => setMsg(c.failed));
              }}
            >
              <Icon name="trash" />
            </button>
          </li>
        ))}
        {items && !items.length && !supported && (
          <li className="row static">
            <span className="tx">
              <span>{c.none}</span>
            </span>
          </li>
        )}
      </ul>
      <p className="help" role="status">
        {msg}
      </p>
    </>
  );
}
