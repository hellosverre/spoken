# Accessibility: requirements and validation plan

Proposed development priorities for this repository's Spoken telephone assistant. These are acceptance targets, not an accessibility audit, completed user research or a claim of WCAG conformance. Read [SPEC.md](SPEC.md) for product decisions and [CONTRACT.md](CONTRACT.md) for interfaces.

## Product identity and research boundaries

Spoken lets the user type a task, follow an AI phone conversation as text and approve decisions. Deaf and nonspeaking people are intended users; people who prefer typing may also benefit. Do not infer a diagnosis or additional impairment from a person's communication preference.

The supplied research summary mixes general accessibility recommendations with claims about a different AAC product called Spoken. Personal word prediction, “Add Words”, Acapela voices, incognito learning and optimised Apple eye tracking are **not established features of this repository**. VoiceOver/TalkBack support also requires device testing; labels or ARIA alone do not prove it. Our speech integration uses ElevenLabs; see [README.md](README.md).

The user-supplied WID percentages (46.4%, 42.9%), NARIC sample of 412 and Blindeforbundet figures (57%, seven in ten) have no original citations attached. Treat these as unverified leads; do not use them as pitch facts until the original study, date, sample, question and denominator are checked. None establishes demand for this product or findings from our own users.

## Priorities for the core call flow

All items below need validation. P0 means a proposed priority for completing a usable core flow, not a statement that the current build fails.

| Priority | Requirement | Observable acceptance check |
|---|---|---|
| P0 | Complete text access | With app audio muted, understand the plan, both speakers, call status, pending approval and outcome. No essential information depends on sound, colour or animation alone. |
| P0 | Accessible controls and focus | Complete task entry, plan review, call, approval, instruction and hangup using keyboard and a screen reader. Controls have meaningful names; dialogs have a name, appropriate focus entry/return and no keyboard trap. New transcript text does not steal focus from typing. |
| P0 | Stable live transcript | Identify each speaker and uncertain recognition. Review earlier text without forced scrolling to the newest message. Announce important status changes without repeatedly reading the entire transcript or every animated word. |
| P0 | Clear, deliberate approval | The approval states the actual price/time/action. Yes and No are distinct, reachable controls. Changes to the proposal must not silently reuse approval for different terms. |
| P0 | Time to communicate | Show understandable waiting/timeout feedback. Test slow typing and assistive input. Never interpret silence as approval; end safely if waiting cannot continue. Server hold limits are constraints to review with users, not evidence that everyone has enough time. |
| P0 | Reachable touch controls | Proposed design target: at least 44 × 44 CSS pixels for key controls, with separation and no mandatory drag/multifinger action. Measure the interactive area, not just the visible icon. |
| P0 | Zoom, contrast and motion | Verify readable text/controls in both themes, keyboard focus visibility, 200% text resizing and reflow at 320 CSS pixels. Check reduced-motion preference and ensure no essential state is lost when animation is reduced. |
| P0 | Honest failure/result states | Network loss, refusal, no answer and unconfirmed agreements remain distinguishable. Preserve user understanding of what was actually confirmed; show an accessible next action. |
| P1 | Personalisation | Evaluate text size, contrast/theme, optional sound, voice/rate and notification preferences with users. These are proposed options, not promises of current support. Haptics must remain optional and cannot be the only signal. |
| P1 | Additional input/support needs | Test OS switch control, voice control and eye tracking where relevant to recruited users/devices. Consider optional setup assistance without giving a helper automatic authority to approve calls or access private history. |

## What follows the phone's own settings

Spoken has no in-app text-size, bold, contrast or motion toggle. iOS is the single source, so nothing is enlarged twice. Only the light/dark/system theme pick remains (it was already a theme choice, default “system”). Built and checked in headless Chromium with emulation only; **not yet tested on a real iPhone or with VoiceOver**.

| iOS setting | Web (Safari) | Expo app |
|---|---|---|
| Larger Text | Root is `font: -apple-system-body` (fallback 100% elsewhere). Text and text-driven spacing are rem, so everything scales; buttons, inputs, tabs use `min-height`, cards and tab labels wrap, no ellipsis on names. Checked at 390 px with root at 200%: no clipping or horizontal overflow. | `allowFontScaling` stays on, no `maxFontSizeMultiplier`. Text buttons, chips, tabs and inputs use `minHeight`; `numberOfLines` removed from names and labels. Not type-checked or run. |
| Bold Text | `-apple-system-body` carries the system weight; Inter weights set explicitly in CSS are unchanged (to verify on device). | `useBoldText()` steps Inter up one cut inside `T`. |
| Reduce Motion | `prefers-reduced-motion` stops animations and pulse rings. | `reduceMotionChanged` (store) and reanimated `useReducedMotion`. |
| Increase Contrast | `prefers-contrast: more`: ink borders, brighter muted text, glows off, 3 px focus ring. | Not implemented. |
| Reduce Transparency | `prefers-reduced-transparency`: glows off, opaque scrim. No blur is used anywhere. | No blur is used; nothing to change. |
| Dark / light | `prefers-color-scheme` via the “system” theme. | `useColorScheme` via the “system” theme. |
| VoiceOver | Icon-only buttons labelled; decorative art and the speaker pods `aria-hidden`; transcript is `role="log"` with `aria-live="polite"`; approval sheet is a modal dialog named by its title and described by its price/time rows; focus moves to the first choice (YES) and NO is the next control; one `h1` per screen. | Labels and roles on touchables; transcript lines are announced with `announceForAccessibility` after the transcript is still for 1.2 s (so a line is not read word by word); approval title is announced and focus moved to the first choice. |

## WCAG reference and units

For this web app, use **CSS pixels**, not native-platform points:

- [WCAG 2.2 SC 2.5.8, Target Size (Minimum), AA](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 24 × 24 CSS pixels, with specified exceptions including spacing. This is not an unconditional 44-point requirement.
- [SC 2.5.5, Target Size (Enhanced), AAA](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html): 44 × 44 CSS pixels, with exceptions. We propose this larger design target for important controls; meeting it alone does not establish AAA conformance.
- [SC 4.1.3, Status Messages, AA](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): assistive technology must be able to identify relevant status messages without moving focus. Use this to guide status announcements, not as a reason to announce every transcription update.

Sources checked 7 November 2026. This short list is not the full WCAG checklist or a determination of legal obligations.

## Current source observations, not pass results

At upstream `c2062cd`, [Call.tsx](web/src/components/Call.tsx) contains polite live regions and dialog markup; [ui.tsx](web/src/components/ui.tsx) contains modal/dialog infrastructure; [globals.css](web/src/app/globals.css) contains reduced-motion rules. These are useful starting points, but their actual interaction must be tested. [config.ts](server/src/config.ts) sets approval hold timing. No device or participant testing was performed for this document.

Privacy descriptions also need verification: CONTRACT says no recordings, while HANDOFF describes debug audio and transcript logs. Database summary-only storage does not prove that no other storage exists. Resolve this before giving participants or the jury a blanket privacy promise.

## User involvement and evidence

Recruit people who actually need text-mediated phone calls, including Deaf/nonspeaking users; include additional access needs where relevant. Ask how they communicate today and what fails, rather than assuming a broad AAC use case. Involve a helper only at the participant's choice. Use agreed simulated recipients first, with accessible information about the test and no sensitive real-world task.

Run a routine task, a changed proposal, slow input, refusal and a dropped connection. Start with the backend mock flow; label scripted tests and test real phone behaviour separately when authorised. Record device/OS/browser, assistive technology/settings, build commit, task, observed barrier, change and retest. Record unaided task completion and mistaken approvals; never equate teammate tests or automated checks with target-user validation.

Keep participant details private. Store only agreed, minimal anonymised findings in the repo. No invented participant counts or quotations. Proposed finding format: “On [build], [anonymous participant/access setup] could/could not [task] because [observation]. Changed [behaviour]; retest [result or pending].”
