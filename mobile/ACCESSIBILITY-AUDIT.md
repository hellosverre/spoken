# Mobile accessibility audit

A code review of the Expo app in `mobile/src`, looking for barriers for people who are blind or use a screen reader, deaf or hard of hearing, low vision, colour blind, or have limited dexterity or motion sensitivity. Requirements and priorities come from [../ACCESSIBILITY.md](../ACCESSIBILITY.md).

**Scope and limits.** First read from the code at commit `7274d73` (branch `mobile-history-background`), 2026-11-07; the detailed sections below describe that version, and their line links may have moved since. A second pass the same day added text scaling and the iPhone/Android accessibility settings ([Text scaling](#text-scaling) and [Phone accessibility settings](#phone-accessibility-settings)), and most findings were then fixed ([Status](#status)). The fixes were checked in the iOS simulator (iPhone 16, iOS 18.6) at the default and the largest accessibility text size, with Increase Contrast on and off. Nothing has been tested with VoiceOver, TalkBack, Bold Text, an Android device, colour filters or switch control, and no disabled users have tried it. Contrast ratios are computed from the tokens in `src/lib/theme.tsx`.

Severity: **High** blocks or seriously harms the core call flow, **Medium** makes it harder, **Low** is polish.

## Summary

| # | Issue | Who | Severity | Status |
|---|---|---|---|---|
| 1 | New call lines are not announced on iOS, only "X is talking" on Android | Blind | High | Fixed, needs VoiceOver/TalkBack test |
| 2 | Approval request may not be announced; focus targets a non-accessible View | Blind | High | Fixed, needs VoiceOver/TalkBack test |
| 3 | Transcript forces scroll to the newest word | Deaf, low vision, everyone | High | Fixed |
| 4 | Real transcript text is delayed by word-by-word pacing | Deaf | High | Fixed |
| 5 | Dim text fails contrast (≈3.1–3.3:1) and carries key info | Low vision | High | Fixed (dim now ≥4.5:1); light-theme accent on its pale tint is still 4.2:1 outside Higher contrast |
| 6 | Button and field outlines are ≈1.2–1.5:1 (Decline is outline only) | Low vision | Medium | Fixed in Higher contrast; standard look unchanged |
| 7 | End call is 38×38 pt with no confirmation | Motor, everyone | Medium | Fixed |
| 8 | No waiting time or hold-limit feedback during an approval | Deaf, slow typists | Medium | Partly: elapsed time shown; no hold limit known to the app |
| 9 | Uncertain speech recognition is shown as plain fact | Deaf | Medium | Open: needs confidence data from the server |
| 10 | Chat live region may re-read the whole thread (Android) | Blind | Medium | Fixed |
| 11 | Fixed-height controls clip at large text sizes | Low vision | Medium | Fixed (see [Text scaling](#text-scaling)) |
| 12 | Mislabelled controls (EN/NO, "…", raw icon names, {tokens}) | Blind | Medium | Fixed |
| 13 | Field errors shown by red border only | Colour blind, blind | Medium | Fixed (commit `d17b16b`) |
| 14 | Small touch targets (30–36 pt) | Motor | Medium | Mostly fixed; send button keeps a 36 pt look with a 44 pt hit area |
| 15 | No `accessibilityLanguage` for Norwegian text | Blind | Low | Fixed |
| 16 | Animations that ignore reduce motion | Vestibular | Low | Fixed for the level meter, typing dots, sheet, flash and word pacing |
| 17 | Selected state shown mostly by subtle colour | Low vision, colour blind | Low | Fixed (commit `d17b16b`) |
| 18 | "Needs you" flash is brief and subtle | Deaf | Low | Partly: approvals are now time sensitive on iPhone; flash unchanged |
| 19 | Approval and result sheet cannot scroll; buttons go off screen at large text | Low vision | High | Fixed |
| 20 | Result sheet's comment box sits under the keyboard | Everyone | Medium | Fixed |
| 21 | Android back sends the app away mid-call | Android users | Medium | Fixed |
| 22 | No support for Bold Text or Increase Contrast / High contrast text | Low vision | Medium | Fixed, Bold Text untested |
| 23 | Portrait only (WCAG 1.3.4) | Mounted devices | Low | Open: needs landscape layout testing |
| 24 | A failed real call is titled in Norwegian in every language | Everyone | Low | Fixed |
| 25 | Passcode stored unencrypted in AsyncStorage | Security | Low | Open: needs `expo-secure-store` and a native rebuild |

## Blind and screen-reader users

### 1. New call lines are not announced (High)
The only live region on the call screen is the speaker label ([`Call.tsx:116`](src/components/Call.tsx#L116)). `accessibilityLiveRegion` is Android only, so on iOS nothing is announced, and on Android the user hears "Pizzeria is talking" but not what was said. The transcript bubbles are grouped with a good `accessibilityLabel` ([`Call.tsx:194-199`](src/components/Call.tsx#L194-L199)) but the user must find them by hand.

**Fix:** when a line finishes (end of `say` / `sayMore` in `src/lib/store.ts`), call `AccessibilityInfo.announceForAccessibility("<speaker>: <text>")`. Announce whole lines, never each word. Consider a setting to turn this off for users who prefer to read at their own pace.

### 2. Approval request may not be announced (High)
`accessibilityRole="alert"` on the "They're waiting on the line" text ([`Call.tsx:330`](src/components/Call.tsx#L330)) does not make iOS speak it. Focus is sent to the `first` ref ([`Call.tsx:271-278`](src/components/Call.tsx#L271-L278)), but that ref is a plain wrapper `View` ([`Call.tsx:341`](src/components/Call.tsx#L341)) that is not an accessibility element, so the focus move probably does nothing. The result sheet never moves focus. On Android the sheet is not a `Modal`, and `accessibilityViewIsModal` is iOS only, so the call screen behind stays reachable.

**Fix:** announce the question ("Spoken needs you: <title>") and move focus to the sheet title (make it `accessible`), then to the first button. Do the same for the result sheet. On Android, hide the call screen behind with `importantForAccessibility="no-hide-descendants"` while the sheet is open.

### 10. Chat thread live region (Medium)
`accessibilityLiveRegion="polite"` sits on the whole thread container ([`Home.tsx:106`](src/components/Home.tsx#L106)). On Android this may re-read the entire thread on each new message or typing indicator. Announce only the new bot message instead.

### 12. Mislabelled controls (Medium)
- Language switch options are labelled "EN" / "NO" ([`Profile.tsx:214`](src/components/Profile.tsx#L214)); the Norwegian option is read as the word "no". Use "English" / "Norsk".
- Typing indicator is labelled "…" ([`ui.tsx:121`](src/components/ui.tsx#L121)). Use "Spoken is typing".
- Preset icon choices are labelled with internal names such as "pizza" or "bag" ([`PresetSheets.tsx:259`](src/components/PresetSheets.tsx#L259)), in English even in Norwegian.
- Template chips are labelled with the raw token, e.g. "{Time}" ([`PresetSheets.tsx:319`](src/components/PresetSheets.tsx#L319)). Use "Insert Time".
- History back button is "‹ Back" ([`History.tsx:51`](src/components/History.tsx#L51)); the angle quote is read aloud.
- The preset card uses the contact name as `accessibilityHint` ([`Presets.tsx:169`](src/components/Presets.tsx#L169)). Hints describe what happens and can be turned off; put the contact in the label.
- Speaker pods expose stray initials ("PE") between the live label and the transcript.

### 15. Pronunciation of Norwegian (Low)
No text sets `accessibilityLanguage`, so Norwegian content is read with the screen reader's default voice, which may be English. Set it from `lang` on transcript bubbles, the plan card and sheets.

## Deaf and hard-of-hearing users

Spoken is built for these users and the core flow is text first. Speakers are told apart by position, bubble style and a name label, which is good. The remaining problems are timing and readability.

### 3. Forced scroll to the newest word (High)
Both the call transcript ([`Call.tsx:170`](src/components/Call.tsx#L170)) and the chat ([`Home.tsx:103`](src/components/Home.tsx#L103)) call `scrollToEnd` on every content size change, which happens on every word. A user who scrolls up to re-read is pulled back down. ACCESSIBILITY.md lists this as P0.

**Fix:** only auto-scroll when the user is already near the bottom; otherwise show a "New messages ↓" button.

### 4. Live text is delayed by pacing (High)
Real speech-to-text lines go through the same `say` animation as the scripted demo: 350–500 ms before a line, then 90–105 ms per word plus 140 ms after punctuation, with lines queued one after another ([`store.ts:686-698`](src/lib/store.ts#L686-L698), [`real-call.ts:237`](src/lib/real-call.ts#L237)). A deaf user reads behind what is being said, and the gap grows when both sides talk quickly. Reduce motion only skips the intro typing ([`store.ts:199`](src/lib/store.ts#L199)), not this.

**Fix:** show real-call lines immediately (or with a much shorter pace), and skip pacing entirely when reduce motion is on.

### 8. No waiting or timeout feedback (Medium)
During an approval the sheet says "They're waiting on the line" with no indication of how long the person has been waiting or when the server will give up. Slow typists and users of assistive input cannot judge how much time they have. Show elapsed hold time and a clear warning before any server limit, and say plainly what happens if time runs out (never treat silence as approval).

### 9. Uncertain recognition looks certain (Medium)
Recognised speech from the other party is shown as plain text ([`real-call.ts:280-290`](src/lib/real-call.ts#L280-L290)). Nothing marks low-confidence words or lines that were revised. ACCESSIBILITY.md requires identifying uncertain recognition. If the speech service provides confidence, mark those words (with more than colour) and let the user ask Spoken to confirm.

### 18. "Needs you" flash is subtle (Low)
The screen-edge flash is two 400 ms pulses of a 2 pt border ([`index.tsx:84`](src/app/index.tsx#L84)). It is backed by haptics and the sheet itself, which is good, but a user looking away can miss it. Consider a persistent banner on the call header while an approval is open, and an option for a camera-flash alert.

System lines ("Calling…", "Connected", "Scripted demo", network errors) are also small, dim and centred ([`Call.tsx:422`](src/components/Call.tsx#L422)); see issue 5.

## Low vision

### 5. Text contrast (High)
| Token | Background | Ratio | Needed |
|---|---|---|---|
| `dim` dark `#5D6475` | app / surface | 3.30 / 3.08 | 4.5 |
| `dim` light `#868D9D` | app / surface | 3.13 / 3.33 | 4.5 |
| light `accent` on `accentSoft` | tinted chip | 4.20 | 4.5 |
| light teal tint `#0E8A78` (outcome "Done", real-calls state) | surface | 4.26 | 4.5 |

`dim` is used for important text: speaker names above bubbles, system lines in the transcript, "Spoken told them:", timestamps and phone numbers, placeholders, help text, plan labels (Goal / Ask / Opening), "Try one" and "Tap to skip". `muted` passes (6.2–6.6:1); raising `dim` toward `muted` for text, and keeping the faint tone only for decoration, would fix most of these.

### 6. Outlines and non-text contrast (Medium)
| Token | Background | Ratio | Needed |
|---|---|---|---|
| `line` dark / light | surface | 1.18 / 1.26 | 3 |
| `line2` dark / light | surface | 1.42 / 1.52 | 3 |

Ghost buttons are outlined with `line2` only, and these include **Decline** on the approval sheet, Edit, Cancel and View transcript. Text fields use `line` for their border, so their edges are close to invisible. The switch's off track uses `line2`. Text inside these controls passes; the boundary does not (WCAG 1.4.11).

### 11. Fixed heights clip large text (Medium)
Text follows the system text size, but containers have fixed heights: `Btn` 44 ([`ui.tsx:186`](src/components/ui.tsx#L186)), fields 48, tabs 56, chips 30 ([`Home.tsx:348`](src/components/Home.tsx#L348)), segment buttons 30 ([`List.tsx:116`](src/components/List.tsx#L116)), token chips 32, feedback input 44. Contact names and tab labels are cut to one line. At the largest accessibility sizes labels will likely clip. Use `minHeight` instead of `height` and test at 200 %.

### 17. Weak selected state (Low)
The selected tab differs by a background change of about 1.03–1.15:1 plus text colour. Segmented controls (theme, language) differ by accent tint and text colour only. Add a stronger fill, a checkmark or a weight change. The idle speaker pod uses 35 % opacity, which is also hard to see.

## Colour blindness

Mostly sound: call outcomes in history have an icon and words as well as colour, speakers are distinguished by layout and labels, and destructive rows have text.

### 13. Field errors by colour only (Medium)
`Field` marks an error by turning the border red ([`ui.tsx:179`](src/components/ui.tsx#L179)). Login adds an error message, but the preset editor shows one general message without saying which field is wrong, and screen readers are not told the field is invalid. Add text under the specific field and include it in the field's accessibility label or hint.

See also issue 17: selection in segmented controls relies mainly on hue.

## Motor and dexterity

### 7. End call (Medium)
The hang-up button is 38×38 pt ([`Call.tsx:389`](src/components/Call.tsx#L389)), next to the contact name, and ends the call at once ([`Call.tsx:67`](src/components/Call.tsx#L67)). On a real call this cannot be undone. Make it at least 44×44 and ask for confirmation (or offer a short undo).

### 14. Small targets (Medium)
| Control | Size | Where |
|---|---|---|
| Send | 36×36 | [`Composer.tsx:82`](src/components/Composer.tsx#L82) |
| New chat | 34×34 | [`Home.tsx:329`](src/components/Home.tsx#L329) |
| Chips (repeat, thanks) | 30 high | [`Home.tsx:348`](src/components/Home.tsx#L348) |
| Language EN/NO | 30 high | [`List.tsx:116`](src/components/List.tsx#L116) |
| Preset delete badge | 30×30, overlapping the card corner | [`Presets.tsx:237`](src/components/Presets.tsx#L237) |

ACCESSIBILITY.md proposes 44×44 for key controls. Where the visual should stay small, add `hitSlop` and check spacing.

## Motion

### 16. Reduce motion is partly respected (Low)
Respected: `Rise`, `PulseRings`, the intro. Not respected: the level-meter bars (infinite repeat, [`Call.tsx:150`](src/components/Call.tsx#L150)), typing dots, caret blink, side glows, screen fades, sheet slide, `FadeIn` entering animations and the flash ring. None of these hides information, but they should calm down when the setting is on. The flash ring pulses at about 1.25 Hz, below the three-flashes-per-second limit.

## Suggested order

1. Issues 1, 2, 3 and 4: whether a blind or deaf user can follow a live call and answer an approval in time.
2. Issues 5, 6 and 7: quick theme and size changes.
3. Device testing with VoiceOver, TalkBack, 200 % text and colour filters to confirm the above and find what code review misses.

## Text scaling

React Native scales text with the phone's setting (iPhone Text Size / Dynamic Type, Android Font size), so the words grow. The layouts around them did not. Findings from the second pass, all fixed:

- **The approval and result sheet could not scroll** (issue 19). It is capped at 85 % of the screen, so at large sizes Approve and Decline could end up off screen. The question now scrolls and the answers stay pinned below it; the result sheet scrolls as a whole.
- **Fixed heights** on buttons, fields, chips, segment buttons, tabs, token chips and the feedback input are now minimum heights with padding.
- **Text cut to one line**: the call's contact name and number now wrap.
- **The tab bar** puts the icon above the label at large sizes. Labels grow to 1.6×; past that, iPhone's Large Content Viewer shows the label on a long press, as system tab bars do.
- **Side-by-side layouts stack** at large sizes (`useLargeText()` in `src/lib/theme.tsx`, from 1.3×): result and approval rows, the plan card's Change and Cancel, multiple-choice times, the "Did it go well?" row, and segmented controls beside a row title.
- **Headings grow less** than body text (`HEADING_SCALE`, 1.4×), and so do the logo and the call screen's header, status line and chips (1.5×), so the transcript keeps the screen. Transcript and body text are never capped. The message box grows to 1.8×.
- **At large sizes the call's speaker card** drops its picture and keeps only "X is talking", and the result sheet drops its illustration.
- **The intro's icons** move in on narrow screens (Display Zoom, 320 pt).

Checked in the simulator at the largest accessibility size: the tab bar stacks, the approval sheet keeps its buttons on screen with the question scrolling, and the call transcript keeps most of the screen. Not yet checked on Android at 200 % font plus the largest display size.

## Phone accessibility settings

| Setting | Platform | What the app now does |
|---|---|---|
| VoiceOver / TalkBack announcements | Both | Each finished call line is read out with its speaker, plus call status lines and new chat replies, queued so they don't cut each other off (`announce` in `src/lib/store.ts`). An approval says "Spoken needs your OK" and moves focus to the question; a result moves focus to its title. |
| Escape gesture (two-finger scrub) | iOS | Closes a call result. An open approval stays until it is answered, so the escape can't decline by accident. |
| Android back | Android | During a call: closes a result, keeps an open approval, otherwise asks "End the call?". It no longer sends the app to the background. |
| Custom actions | Both | Preset cards offer Edit and Delete from the screen-reader actions menu, so no one has to find edit mode's small badges. |
| Bold Text | iOS | Every Inter weight steps up one (`bolder` in `src/lib/theme.tsx`, with Inter 700 loaded), since iOS can't embolden a custom font itself. |
| Increase Contrast / High contrast text | Both | Switches to the `DARK_HC` / `LIGHT_HC` palettes: secondary text near ink, outlines at 3:1 or more. A Higher contrast switch in Profile works on any phone and overrides the system setting once used. |
| Reduce Motion | Both | The sheet fades instead of sliding, the level meter and typing dots stand still, the flash lights once instead of pulsing, and call text appears whole. |
| Large Content Viewer | iOS | On the tab bar (above). |
| Spoken language | iOS | `accessibilityLanguage` is `nb-NO` or `en-US` on text, transcript lines and sheet titles, so Norwegian is read with a Norwegian voice. |
| Time-sensitive notifications | iOS | Approval notifications ask for `interruptionLevel: "timeSensitive"`, to get through Focus modes. This needs the Time Sensitive Notifications capability, which is **not** added yet (`app.config.js`); without it iOS treats them as normal. |
| Haptics | Both | A Profile switch turns the approval buzz off. The flash, sheet and sound still signal. |

Still open: landscape (issue 23); a lock-screen or Dynamic Island call status (iOS Live Activity, Android ongoing notification); saved quick phrases beyond "repeat" and "thanks" (a product decision to make with users).

## Status

All of the "Fixed" items above are code changes that typecheck. Only the text-scaling and contrast fixes have been looked at, in the iOS simulator. Before claiming support for any assistive technology (see [../ACCESSIBILITY.md](../ACCESSIBILITY.md)), test on real phones:

1. VoiceOver and TalkBack through a whole call: lines read once each, approval focus, the escape gesture, Android back.
2. Bold Text on iPhone; High contrast text on Android.
3. Android at 200 % font and the largest display size.
4. Switch Control / Switch Access and Voice Control / Voice Access, using the visible button names.
