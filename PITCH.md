# Pitch preparation

Working notes for the team, not claims of completed features or validated demand. Product decisions remain in [SPEC.md](SPEC.md), interfaces in [CONTRACT.md](CONTRACT.md), and current engineering observations in [HANDOFF.md](HANDOFF.md).

## Jury format

Source: Oslo Sprint, *Saturday morning* presentation, 7 November 2026, slides 4–6 and speaker notes. Check Discord announcements for changes.

- Open round: 2 minutes of demo + 1 minute of questions. Criteria: functionality, a real problem, innovation, design, and team efficiency. No numerical weights are specified.
- Final: top 10 teams, 5–10 minutes of pitch plus questions. Each juror scores their own field. The questions below adapt those fields to Spoken; they are preparation prompts, not a guaranteed jury script.
- Show the working core flow live with two willing jurors: one uses the app and one answers on speakerphone. No recording or mock fallback is available for this pitch. If the call fails, say so and show only the available app screens. Separate tested behaviour from plans.

## Questions to prepare

For each field, prepare a short answer with one concrete example. Assign a speaker before rehearsal. All answers below still need team confirmation and evidence.

| Field | Question | What the answer should cover | Evidence to bring |
|---|---|---|---|
| Founders | What is your next step if you win? | Propose a focused pilot with a defined user group and one routine call task. Explain what the prize enables, who owns the next step, and how success will be measured. | A team-approved next milestone, budget and pilot success criterion. Do not imply a pilot partner has agreed without confirmation. |
| IT and security | What is the biggest technical risk, and what happens when a call fails? | Pick the highest risk supported by testing, such as misheard numbers, turn-taking or a disconnected call. Explain how the user sees uncertainty, stops the call and distinguishes a confirmed result from an unknown outcome. | A reproducible failure case and the observed recovery behaviour. Test network loss and an ambiguous price/time; verify approval controls in the actual build. |
| Product | What did you leave out, and why? | Explain the cuts that protect the core flow: task, clarification, approved plan, call, user input and result. SPEC lists native apps as later and voice cloning/multiple calls as stretch goals; confirm what the team actually deferred. | One successful end-to-end demo and a short list of deliberate cuts with reasons. |
| Marketing | How will you get your first 100 users? | Propose a first segment and reachable channel, such as opt-in outreach through relevant communities. Explain how a small pilot could lead to referrals and wider recruitment. | A proposed recruitment funnel with assumptions, an owner and a way to measure completed useful calls and repeat use. No invented signups, conversion rates or partnerships. |
| Creative and design | What did you learn from user testing? | Describe who tried which task, where they struggled, what changed and whether the change helped. Check live text readability, call status and approval clarity without spoken guidance. | An anonymised observation and a before/after example. If target users have not tested it, say so and distinguish teammate testing from target-user validation. |
| Law | What must be clarified about personal data, consent and agreements? | Map what is sent to each provider and what is stored. Identify questions about lawful processing, sensitive information, disclosure, retention, deletion and the user's authority to approve a booking or payment. | A current data-flow/retention inventory and unresolved questions for qualified review. Do not claim legal compliance from a product specification alone. See the discrepancy below. |
| Domain experts | How does this fit users' everyday lives and existing alternatives? | Explain a specific situation where a phone call remains necessary. Compare the flow with alternatives users actually use, such as online booking, text channels, relay/interpreting services or help from another person. | A real user account or observed workflow, with permission to quote. Explain when Spoken is useful and when another option works better; avoid unsupported claims that no alternatives exist. |

## Privacy discrepancy to resolve before the pitch

- [CONTRACT.md](CONTRACT.md) says there is no audio recording and transcripts are not stored server-side after a call.
- [HANDOFF.md](HANDOFF.md), under “Debug data from real calls”, describes saved audio with `SAVE_CALL_AUDIO=1` and JSONL logs containing transcripts.
- These documents do not establish the current runtime setting or whether prior files have been deleted. The responsible engineer must verify actual capture, provider handling, access and retention, then reconcile the documents with the intended policy.
- Until resolved, do not tell the jury that audio is never recorded or that all transcripts stay only on the phone. Do not put real call data or personal details into pitch evidence.

## Rehearsal checklist

- [ ] Assign a speaker and confirm a short, evidence-backed answer for each field.
- [ ] Rehearse the 2-minute demo and 1-minute Q&A separately from the longer final.
- [ ] Show a real core flow and one user-control moment; identify anything scripted.
- [ ] Test a failure and describe only the recovery the build actually supports.
- [ ] Fill gaps in user evidence honestly; obtain permission for quotes or recordings.
- [ ] Resolve the privacy discrepancy and distinguish open legal questions from reviewed conclusions.
- [ ] Rehearse the live-only demo and the honest failure response; no recording or mock fallback.
