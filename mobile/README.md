# Spoken mobile

Expo (SDK 58) + React Native. The phone app of the web app in `../web`, with the same "Midnight" design, flows and copy (EN/NO): the intro animation, a chat with Spoken that ends in a plan card, and the live call with its speaker card, transcript, mid-call instructions and approval/result sheet.

Calls are scripted (pizza pickup, doctor's appointment). Nothing is dialled yet.

On top of the web design, mobile adds:

- **Home tab with presets** (replaces the web's Demo tab, and is where you land): see [Presets](#presets).
- **Login** at startup, after the intro. A placeholder: only `demo` / `demo` gets in, nothing leaves the phone. Real accounts plug into `store.login()`.
- **Profile tab** (replaces the web's Settings tab): your name and phone, appearance, language, replay intro, log out.
- **Light and dark mode**: Auto (follows the phone), Light or Dark. Dark is the web's Midnight palette; Light is its counterpart in `src/lib/theme.tsx`.
- **Back to home** on the call screen once the call has ended.
- **Cancel** on the plan card, next to Change: drops the plan and starts an empty chat.
- **A bigger tab bar**: full width, 56 pt tabs, every label shown.
- **Plainer labels**: no "Live" status pill or blinking dots in the call, and small labels are sentence-case Inter instead of the web's uppercase mono ("Spoken", "You", not "SPOKEN · AI", "YOU → SPOKEN"). Mobile-only names live in `copy-mobile.ts`.

```bash
npm install --legacy-peer-deps
npx expo start        # scan the QR code with Expo Go (iPhone camera, or the Expo Go app on Android)
npm run typecheck
```

Everything used is included in Expo Go (Reanimated, SVG, Haptics, AsyncStorage), so no custom build is needed.

## Shared with the web app

| File | Relation to `../web/src/lib` |
|---|---|
| `src/lib/i18n.ts` | Copied unchanged: every string, EN and NO |
| `src/lib/scenarios.ts` | Copied unchanged: the scripted calls and the `CallIO` seam (`say` / `ask`) where the real call server plugs in |
| `src/lib/store.ts` | Same store and flows. Native swaps: AsyncStorage for the language, haptics/vibration for `navigator.vibrate`, the OS reduce-motion setting, and the intro bubble measuring its own text. Mobile additions in one block: login, theme, profile |
| `src/lib/use-spoken.tsx` | Same hooks |
| `src/lib/theme.tsx` | The Midnight colours from `globals.css` (dark), a light palette, `ThemeProvider` and `makeStyles`. Inter only (no Geist Mono) |
| `src/lib/copy-mobile.ts` | Mobile-only strings (login, profile, appearance), EN and NO |

When the web copy or scripts change, copy `i18n.ts` / `scenarios.ts` across again.

## Screens

`src/app/index.tsx` is the device: four layers (intro, login, home, call) that crossfade, as in the web's `SpokenApp`, plus the accent flash ring when Spoken needs you.

| Component | What |
|---|---|
| `Intro.tsx` | Bubble drop, morph, typed tagline, icon pops. Tap to skip |
| `Login.tsx` | Username and password, demo hint, error on wrong details |
| `Home.tsx` | Top bar, the three tabs, tab bar (Home · Chat · Profile). The chat: thread, plan card, preset chips, composer |
| `Presets.tsx` | The Home tab: preset grid, edit mode (delete, restore built-ins), new preset, demo rows |
| `PresetSheets.tsx` | Page sheets to use a preset (fill fields, preview, send) and to create or edit one |
| `Profile.tsx` | Profile card, name and phone, theme, language, replay intro, log out |
| `List.tsx` | Grouped list rows and the segmented control |
| `Call.tsx` | Call header with name, number, timer and hang-up, speaker card with level bars, bubble transcript, instruction chips and composer, bottom sheet for approvals and results |
| `Composer.tsx`, `ui.tsx`, `Icon.tsx` | Growing input, labelled field, buttons with press scale, rise-in, typing dots, the app's glyphs and wordmark |

Every style sheet is built with `makeStyles((C) => ({ … }))` from the active palette, so nothing hard-codes a colour.

Left out on purpose: the web's pitch panel (wide screens only), the D/R/L keyboard shortcuts, and (for now) `web/src/lib/real-call.ts`, the web's real-call wiring. Android's back button skips the intro, returns to the Chat tab, or leaves an ended call.

## Presets

Reusable call requests such as "Call mom" or "Order a pizza", with fields you fill in each time. Four are built in (pizza, doctor, mom, haircut). You can add your own, edit any of them including the built-ins, delete them, and restore the built-ins.

Everything lives in `src/lib/presets.ts`, so the real implementation only has to touch two places:

| Seam | Today | Later |
|---|---|---|
| `PresetRepo` (`load`, `save`) | `localPresetRepo` (AsyncStorage on the phone) | A server-backed repo with the same two methods |
| `store.runPreset(req: PresetRequest)` | Sends `req.text` to the chat, like typed input | Also pass `req.contact` so the call skips the number lookup |

A preset's template uses `{Field name}` tokens (`Call mom and tell her {Message}`); `fillTemplate()` fills them in. Built-ins that haven't been edited follow the app language; once edited they keep their own text.

The calls themselves are still the two web scripts, so any preset that isn't about a doctor plays the pizza call until the real call server is wired in.
