# Click-test findings (mock mode, 390/1440, dark/light, reduced motion)

Flow passes in all 6 runs, 0 console errors, 0 failed requests, refresh on onboarding and deep routes OK.
Screenshots: e2e/shots (regenerate: `bun run build && node e2e/flow.mjs`).

1. Onboarding language buttons (English / Norsk) are 36 px tall, under 44 px. See shots/onboarding-1-390-dark.png. Owner: Form.
2. "Skip to content" link is 42 px tall when focused. Minor.
3. Settings/onboarding checkbox rows measure 22 px by the label box; the rows look about 44 px apart, so likely fine but worth a real tap check on a device. See shots/settings-390-dark.png.
