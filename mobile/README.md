# Spoken mobile

Expo (SDK 58) + React Native. The phone app of the web app in `../web`, with the same "Midnight" design, flows and copy (EN/NO): the intro animation, a chat with Spoken that ends in a plan card, and the live call with its speaker card, transcript, mid-call instructions and approval/result sheet.

Calls go through the Spoken call server, like the web app (see [Real calls](#real-calls)). Without the demo passcode the server runs them in mock mode, so no phone rings. Turn the server off in Profile and the two scripted web demos (pizza, doctor) play on the phone instead.

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
| `src/lib/store.ts` | Same store and flows, including the web's real-call wiring. Native swaps: AsyncStorage for the language, haptics/vibration for `navigator.vibrate`, the OS reduce-motion setting, and the intro bubble measuring its own text. Mobile additions in one block: login, theme, profile |
| `src/lib/use-spoken.tsx` | Same hooks |
| `src/lib/theme.tsx` | The Midnight colours from `globals.css` (dark), a light palette, `ThemeProvider` and `makeStyles`. Inter only (no Geist Mono) |
| `src/lib/copy-mobile.ts` | Mobile-only strings (login, profile, appearance, calls), EN and NO |
| `src/lib/real-call.ts` | Ported from the web: server plan → plan card, live WebSocket → transcript and approvals. Phone differences: a full server URL, and the switch and passcode come from Profile instead of the URL and a browser prompt |

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

Left out on purpose: the web's pitch panel (wide screens only) and the D/R/L keyboard shortcuts. Android's back button skips the intro, returns to the Chat tab, or leaves an ended call.

## Presets

Reusable call requests such as "Call mom" or "Order a pizza", with fields you fill in each time. Four are built in (pizza, doctor, mom, haircut). You can add your own, edit any of them including the built-ins, delete them, and restore the built-ins.

Everything lives in `src/lib/presets.ts`, so the real implementation only has to touch two places:

| Seam | Today | Later |
|---|---|---|
| `PresetRepo` (`load`, `save`) | `localPresetRepo` (AsyncStorage on the phone) | A server-backed repo with the same two methods |
| `store.runPreset(req: PresetRequest)` | Sends `req.text` to the chat; a preset's phone number goes to the server so it skips the lookup | Nothing more needed for calls |

A preset's template uses `{Field name}` tokens (`Call mom and tell her {Message}`); `fillTemplate()` fills them in. Built-ins that haven't been edited follow the app language; once edited they keep their own text.

Built-ins leave the number empty, so the server looks it up from the text; they name places its demo directory knows (Domino's Storo, Legekontoret, Frisøren, see `server/src/directory.ts`). Call mom needs her number: edit the preset and add it. With the server switched off, any preset that isn't about a doctor plays the scripted pizza call.

## Real calls

The same flow as `web/src/lib/real-call.ts`:

1. Your request goes to `POST /api/tasks`, then `/answers` (the server's clarifying questions are off for now, as on the web). Its plan fills the plan card.
2. **Start call** posts `/api/tasks/:id/call`, with the demo passcode as `X-Spoken-Passcode` if one is set in Profile.
3. The live WebSocket `/api/calls/:id/live` drives the transcript, the approval sheet and the result. Your messages, the chips and hang-up go back over it. Spoken's turns arrive clause by clause and grow one bubble; the other side's lines wait up to 1.2 s for the server's second STT opinion.

Every request carries `X-Spoken-Device` (a random id made once and kept on the phone). The server keeps a profile per device (Supabase), and before planning the app merges your Profile name and phone into it, so the call says it's calling on behalf of you. A preset's contact goes along so its number skips the lookup.

| Setting | Where | Default |
|---|---|---|
| Server URL | `EXPO_PUBLIC_SPOKEN_API` at `npx expo start` | `https://spoken-api.hellosverre.com` |
| Use the server | Profile → Calls | On |
| Demo passcode | Asked in the chat before a call if it's empty, or Profile → Calls (kept on the phone; cleared if the server says it's wrong) | Empty, and `skip` = practice calls with a scripted callee, no phone rings, and the call screen says so |
| Your name on calls | Profile → Your name | Empty: the call says «en bruker» |

With the right passcode the server places a real Telnyx call, only to numbers on its `CALL_ALLOWLIST`. Built-in presets have no number and use the server's demo directory, whose numbers aren't real, so save a real number in a preset to call it.

## On your own iPhone (no paid Apple account)

A free Apple ID can sign a build for your own phone; it expires after 7 days. With the phone plugged in, Developer Mode on, and your Apple ID in Xcode:

```bash
APPLE_TEAM_ID=<your team> IOS_BUNDLE_ID=<com.you.spoken> npx expo prebuild --platform ios --clean
xcodebuild -workspace ios/Spoken.xcworkspace -scheme Spoken -configuration Release \
  -destination id=<iPhone UDID> -derivedDataPath ios/build -allowProvisioningUpdates build
xcrun devicectl device install app --device <iPhone UDID> ios/build/Build/Products/Release-iphoneos/Spoken.app
```

`app.config.js` reads the two variables, so neither is committed. Your team ID is the `OU` of your "Apple Development" certificate; `xcrun devicectl list devices` shows the UDID. On the phone, trust the developer once in Settings → General → VPN & Device Management.

The app icon and in-app mark are the web's Duet logo (`web/src/app/icon.svg`).
