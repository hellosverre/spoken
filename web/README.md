# Spoken web

Vite + React + TypeScript. Phone first, works at 390 px and 1440 px. Builds with no server: the in-browser mock plays a scripted Domino's call.

```bash
bun install
bun run dev          # http://localhost:5173, mock mode
bun run build        # tsc + vite build
node design/shoot-screens.mjs   # clicks the whole flow headless, screenshots to design/screens/
```

`?mockSpeed=3` in the URL speeds the mock call up.

## Server or mock

| Env | Effect |
|---|---|
| none | In-browser mock (`src/api/mock.ts`, `src/api/mockCall.ts`) |
| `VITE_API_URL` (+ `VITE_WS_URL`, otherwise derived from it) | Real server over REST + `/api/calls/:id/live` |
| `VITE_MOCK=1` | Force the mock even with URLs set |

Every type comes from `../shared/contract.ts`. The mock emits the same `LiveEvent`s as the server: partial transcript events word by word, a confidence per word, `approval_request`, `note` and `result`.

## Where the design goes

All the visual work happens in `src/theme/`. Nothing in `src/screens` or `src/components` sets a colour, font or size.

| File | What to do with it |
|---|---|
| `src/theme/tokens.css` | **Replace first.** Colour, type, space, radius and motion variables. Dark is the default, plus `[data-theme=light]`, `[data-contrast=high]`, `[data-text=big]` and `[data-motion=reduce]`. |
| `src/theme/components.css` | **Replace.** Plain layout and state styles for every `sp-*` class. Restyle freely. |
| `src/theme/base.css` | Keep: reset, focus ring, visually-hidden, skip link, reduced-motion override. |
| `src/components/ui.tsx` → `ICONS` | Redraw the custom glyphs in place. Keep the names. |

The contract between the code and the design is the class names and data attributes:

- **Screens:** `.sp-screen[data-screen=onboarding-1|onboarding-2|onboarding-3|home|clarify|plan|plan-blocked|call|result|settings|privacy]`. The call screen also gets `data-status`, `data-approval` and `data-connection`.
- **Buttons:** `.sp-btn[data-variant=primary|secondary|ghost|danger|yes|no][data-size=sm|md|lg|xl]`, with `data-busy` while loading.
- **Transcript:** `.sp-line[data-who=callee|agent][data-final][data-recent]` › `.sp-word[data-unsure]`, plus `.sp-caret` while a line is still arriving and `.sp-typing` before the AI speaks.
- **Approval:** `.sp-approval` (role `alertdialog`) › `.sp-approval__options[data-count]` › `.sp-btn[data-variant=yes|no][data-size=xl]`.
- **Alerts:** `.sp-flash[data-active=connected|approval|ended]`, the full-screen flash.

Hooks for Glimt (motion and sound): `useAlerts().notify(kind, message)` in `src/lib/alerts.tsx` fires on connected, approval and ended. Add sound there. Each new word mounts a fresh `.sp-word`, so a CSS entrance animation runs once per word.

## Structure

| Path | What |
|---|---|
| `src/App.tsx` | Providers and the route switch. Anything except onboarding and privacy redirects to onboarding until it's done. |
| `src/lib/router.tsx` | Hash router, so any static host works without rewrites |
| `src/state/store.tsx` | One reducer. Settings, profile and places go to localStorage, the current task flow to sessionStorage. |
| `src/state/useLiveCall.ts` | Turns the live events into what the call screen renders |
| `src/api/` | `http.ts` (REST + WebSocket that reconnects up to 6 times), `mock.ts`, `config.ts` |
| `src/i18n/` | `en.ts` holds the keys, `nb.ts` is type-checked against it. Access text with `const { d } = useT(); d.home.title`. |
| `src/lib/alerts.tsx` | Vibration, screen flash and an assertive screen-reader announcement |
| `src/lib/stack.ts` | Content for the "Built with ElevenLabs" panel (model per step and latency) |

## Accessibility

- Each screen moves focus to its `h1` when it opens.
- The transcript is a `role=log`. Only finished sentences are announced, so partial words don't flood the screen reader.
- The JA button gets focus when an approval appears.
- Settings has toggles for bigger text, high contrast and reduced motion. The OS settings for contrast and motion are respected too.
- Touch targets are at least 48 px (56 px with big text), and JA / NEI are 96 px.
- Hanging up takes two taps.
