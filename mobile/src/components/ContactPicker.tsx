import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Contacts from "expo-contacts/legacy";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { em, F, makeStyles, PAD, useTheme } from "../lib/theme";
import { serverUrl } from "../lib/real-call";
import { useSpoken } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { e164List } from "./phone";
import { Btn, T } from "./ui";

/* Phone contacts on iOS and Android through expo-contacts. The permission is asked when the
   user taps "Import" or the contacts button, never at start-up. The picked people are saved
   to the per-device /api/contacts the server already has (the same X-Spoken-Device id the
   store keeps in AsyncStorage). Written without a type-check: node_modules is not installed
   in the sprint worktree, so run `npm run typecheck` in mobile/ before the demo build. */

export interface Picked {
  name: string;
  phone: string;
}
export interface SavedContact extends Picked {
  id: string;
  kind: "business" | "person";
}
interface Entry extends Picked {
  key: string;
}

const COPY = {
  en: {
    import: "Import from phone",
    importS: "Choose people from your contacts",
    pick: "Pick from contacts",
    title: "Contacts",
    cancel: "Cancel",
    search: "Search name or number",
    add: (n: number) => (n ? `Add ${n}` : "Add"),
    use: "Use",
    saved: "Saved contacts",
    none: "No saved contacts yet.",
    empty: "No contacts with a phone number.",
    denied: "Spoken has no access to your contacts. Turn it on in Settings.",
    settings: "Open Settings",
    added: (n: number) => `${n} added`,
    nothing: "Nothing new to add.",
    failed: "Could not save the contacts. Try again.",
    remove: (n: string) => `Remove ${n}`,
    selected: "selected",
  },
  no: {
    import: "Importer fra telefonen",
    importS: "Velg folk fra kontaktene dine",
    pick: "Velg fra kontakter",
    title: "Kontakter",
    cancel: "Avbryt",
    search: "Søk på navn eller nummer",
    add: (n: number) => (n ? `Legg til ${n}` : "Legg til"),
    use: "Bruk",
    saved: "Lagrede kontakter",
    none: "Ingen lagrede kontakter ennå.",
    empty: "Ingen kontakter med telefonnummer.",
    denied: "Spoken har ikke tilgang til kontaktene dine. Slå det på i Innstillinger.",
    settings: "Åpne Innstillinger",
    added: (n: number) => `${n} lagt til`,
    nothing: "Ingen nye å legge til.",
    failed: "Kunne ikke lagre kontaktene. Prøv igjen.",
    remove: (n: string) => `Fjern ${n}`,
    selected: "valgt",
  },
} as const;

function useCopy() {
  return COPY[useSpoken((s) => s.lang)];
}

/* ---- server ---- */

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const device = (await AsyncStorage.getItem("spoken-device").catch(() => null)) ?? "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(serverUrl() + path, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(device ? { "X-Spoken-Device": device } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const listSaved = () => api<SavedContact[]>("GET", "/api/contacts");
const removeSaved = (id: string) => api<{ ok: true }>("DELETE", `/api/contacts/${id}`);

/** Save picked people; numbers already saved are skipped. Returns how many are new. */
async function saveContacts(picked: Picked[]): Promise<number> {
  const have = new Set((await listSaved()).map((c) => c.phone));
  let n = 0;
  for (const p of picked) {
    if (have.has(p.phone)) continue;
    have.add(p.phone);
    await api("POST", "/api/contacts", { name: p.name, phone: p.phone, kind: "person" });
    n++;
  }
  return n;
}

/* ---- the sheet ---- */

type Phase = "asking" | "loading" | "ready" | "denied";

/** A searchable, multi-select list of the phone's contacts. onDone gets the chosen people. */
export function ContactPickerSheet({
  visible,
  multiple = true,
  onClose,
  onDone,
}: {
  visible: boolean;
  multiple?: boolean;
  onClose(): void;
  onDone(picked: Picked[]): void;
}) {
  const c = useCopy();
  const { C, scheme } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>("asking");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());

  // Ask for permission only now that the sheet is open (the user tapped for it).
  useEffect(() => {
    if (!visible) return;
    let live = true;
    setPhase("asking");
    setQuery("");
    setChosen(new Set());
    (async () => {
      try {
        const perm = await Contacts.requestPermissionsAsync();
        if (!perm.granted) return live && setPhase("denied");
        if (live) setPhase("loading");
        const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers], sort: Contacts.SortTypes.FirstName });
        const out: Entry[] = [];
        for (const ct of data) {
          for (const phone of e164List((ct.phoneNumbers ?? []).map((p) => p.number ?? p.digits ?? ""))) {
            out.push({ key: `${ct.id}:${phone}`, name: (ct.name ?? "").trim() || phone, phone });
          }
        }
        if (live) {
          setEntries(out);
          setPhase("ready");
        }
      } catch {
        if (live) setPhase("denied");
      }
    })();
    return () => {
      live = false;
    };
  }, [visible]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q) || (digits.length > 1 && e.phone.includes(digits)));
  }, [entries, query]);

  const toggle = useCallback(
    (key: string) =>
      setChosen((s) => {
        if (!multiple) return new Set([key]);
        const next = new Set(s);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [multiple],
  );

  const done = () => {
    onDone(entries.filter((e) => chosen.has(e.key)).map(({ name, phone }) => ({ name, phone })));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={[styles.head, Platform.OS === "android" && { paddingTop: insets.top + 8 }]}>
          <View style={styles.headSide}>
            <Pressable accessibilityRole="button" accessibilityLabel={c.cancel} onPress={onClose} hitSlop={10}>
              <Text style={styles.headBtn}>{c.cancel}</Text>
            </Pressable>
          </View>
          <Text style={styles.headTitle} accessibilityRole="header">
            {c.title}
          </Text>
          <View style={[styles.headSide, styles.headRight]}>
            <Pressable accessibilityRole="button" accessibilityLabel={multiple ? c.add(chosen.size) : c.use} disabled={!chosen.size} onPress={done} hitSlop={10}>
              <Text style={[styles.headBtn, styles.headStrong, !chosen.size && { opacity: 0.4 }]}>{multiple ? c.add(chosen.size) : c.use}</Text>
            </Pressable>
          </View>
        </View>

        {phase === "denied" ? (
          <View style={styles.center}>
            <T size={15} color={C.muted} style={styles.centerText}>
              {c.denied}
            </T>
            <Btn kind="ghost" label={c.settings} onPress={() => Linking.openSettings().catch(() => {})} />
          </View>
        ) : phase !== "ready" ? (
          <View style={styles.center}>
            <ActivityIndicator color={C.accent} />
          </View>
        ) : (
          <>
            <View style={styles.searchWrap}>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={c.search}
                placeholderTextColor={C.dim}
                accessibilityLabel={c.search}
                selectionColor={C.accent}
                cursorColor={C.accent}
                keyboardAppearance={scheme}
                autoCorrect={false}
                clearButtonMode="while-editing"
                returnKeyType="search"
                style={styles.search}
              />
            </View>
            <FlatList
              data={shown}
              keyExtractor={(e) => e.key}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
              ListEmptyComponent={
                <T size={14} color={C.dim} style={styles.centerText}>
                  {c.empty}
                </T>
              }
              initialNumToRender={20}
              renderItem={({ item }) => {
                const on = chosen.has(item.key);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${item.name}, ${item.phone}`}
                    accessibilityState={{ checked: on }}
                    onPress={() => toggle(item.key)}
                    style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                  >
                    <View style={styles.grow}>
                      <T size={15} weight="medium" numberOfLines={1}>
                        {item.name}
                      </T>
                      <T size={13} color={C.dim}>
                        {item.phone}
                      </T>
                    </View>
                    <View style={[styles.box, on && { backgroundColor: C.accent, borderColor: C.accent }]}>
                      {on ? <Icon name="check" color={C.inv} size={14} strokeWidth={2.4} /> : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

/* ---- Composer button ---- */

/** Outlined contacts button for the chat field. Inserts "Name +47…" into the request. */
export function ContactsButton({ onInsert }: { onInsert(text: string): void }) {
  const c = useCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={c.pick} onPress={() => setOpen(true)} style={styles.iconBtn}>
        <Icon name="person" color={C.ink} size={18} />
      </Pressable>
      {open ? (
        <ContactPickerSheet
          visible
          multiple={false}
          onClose={() => setOpen(false)}
          onDone={([first]) => {
            setOpen(false);
            if (!first) return;
            onInsert(`${first.name} ${first.phone}`);
            saveContacts([first]).catch(() => {});
          }}
        />
      ) : null}
    </>
  );
}

/* ---- Profile section ---- */

/** Profile → Contacts: "Import from phone" and the saved list. */
export function ContactsSection() {
  const c = useCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const [items, setItems] = useState<SavedContact[]>([]);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    listSaved().then(setItems, () => {});
  }, []);
  useEffect(load, [load]);

  async function finish(picked: Picked[]) {
    setOpen(false);
    if (!picked.length) return;
    try {
      const n = await saveContacts(picked);
      setMsg(n ? c.added(n) : c.nothing);
      load();
    } catch {
      setMsg(c.failed);
    }
  }

  return (
    <View style={styles.list}>
      <Pressable accessibilityRole="button" accessibilityLabel={c.import} onPress={() => setOpen(true)} style={styles.listRow}>
        <Icon name="plus" color={C.accent} size={18} />
        <View style={styles.grow}>
          <T size={14.5} weight="medium">
            {c.import}
          </T>
          <T size={13} color={C.dim}>
            {c.importS}
          </T>
        </View>
        <Icon name="chevron" color={C.dim} size={16} />
      </Pressable>
      {items.map((x) => (
        <View key={x.id} style={[styles.listRow, styles.rowLine]}>
          <Icon name="person" color={C.accent} size={18} />
          <View style={styles.grow}>
            <T size={14.5} weight="medium" numberOfLines={1}>
              {x.name}
            </T>
            <T size={13} color={C.dim}>
              {x.phone}
            </T>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={c.remove(x.name)}
            hitSlop={10}
            onPress={() => {
              removeSaved(x.id).then(load, () => setMsg(c.failed));
            }}
          >
            <Icon name="trash" color={C.dim} size={17} />
          </Pressable>
        </View>
      ))}
      {!items.length ? (
        <T size={13} color={C.dim} style={styles.none}>
          {c.none}
        </T>
      ) : null}
      {msg ? (
        <T size={13} color={C.dim} style={styles.none} accessibilityLiveRegion="polite">
          {msg}
        </T>
      ) : null}
      {open ? <ContactPickerSheet visible onClose={() => setOpen(false)} onDone={finish} /> : null}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  modal: { flex: 1, backgroundColor: C.app },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  headSide: { width: 96 },
  headRight: { alignItems: "flex-end" },
  headTitle: { flex: 1, textAlign: "center", fontFamily: F.semibold, fontSize: 16, color: C.ink },
  headBtn: { fontFamily: F.regular, fontSize: 16, color: C.accent },
  headStrong: { fontFamily: F.semibold },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: PAD },
  centerText: { textAlign: "center", padding: PAD },
  searchWrap: { paddingHorizontal: PAD, paddingVertical: 12 },
  search: {
    fontFamily: F.regular,
    fontSize: 16,
    letterSpacing: em(-0.006, 16),
    color: C.ink,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: PAD, paddingVertical: 11, minHeight: 56 },
  grow: { flex: 1, minWidth: 0 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: C.line2, alignItems: "center", justifyContent: "center" },
  iconBtn: { width: 36, height: 36, borderRadius: 9, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  list: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, overflow: "hidden" },
  listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  rowLine: { borderTopWidth: 1, borderTopColor: C.line },
  none: { paddingHorizontal: 14, paddingVertical: 10 },
}));
