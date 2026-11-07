import { AnimatePresence, LayoutGroup, MotionConfig, motion, useIsPresent } from "motion/react";
import type { ReactNode } from "react";
import { IS_MOCK } from "./api/index.ts";
import { useT } from "./i18n/useT.ts";
import { AlertProvider } from "./lib/alerts.tsx";
import { Redirect, useRoute, type Route } from "./lib/router.tsx";
import { useApplyTheme } from "./lib/useApplyTheme.ts";
import { pageVariants } from "./motion/presets.ts";
import { useCalm } from "./motion/useCalm.ts";
import { Call } from "./screens/Call.tsx";
import { Clarify } from "./screens/Clarify.tsx";
import { Home } from "./screens/Home.tsx";
import { Onboarding } from "./screens/Onboarding.tsx";
import { Plan } from "./screens/Plan.tsx";
import { Privacy } from "./screens/Privacy.tsx";
import { Result } from "./screens/Result.tsx";
import { Settings } from "./screens/Settings.tsx";
import { StoreProvider, useStore } from "./state/store.tsx";

const ONBOARDING: Route = { name: "onboarding", step: 1 };
const HOME: Route = { name: "home" };

function routeKey(r: Route): string {
  if (r.name === "onboarding") return `onboarding-${r.step}`;
  if (r.name === "call" || r.name === "result") return `${r.name}-${r.callId}`;
  return r.name;
}

/**
 * Screens cross over in one grid cell, so the old page can leave while the new
 * one springs in, and elements with a shared layoutId morph between them.
 */
function Stage() {
  const route = useRoute();
  const { state } = useStore();
  // Privacy is readable before onboarding; everything else needs it done.
  if (!state.onboarded && route.name !== "onboarding" && route.name !== "privacy") return <Redirect to={ONBOARDING} />;
  return (
    <LayoutGroup>
      <div className="sp-stage">
        <AnimatePresence initial={false}>
          <Page key={routeKey(route)} name={route.name}>
            {screenFor(route)}
          </Page>
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

/** A leaving page is inert: no focus, no clicks, hidden from screen readers. */
function Page({ name, children }: { name: string; children: ReactNode }) {
  const present = useIsPresent();
  return (
    <motion.div
      className="sp-page"
      data-route={name}
      inert={!present}
      variants={pageVariants}
      initial="initial"
      animate="enter"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}

function screenFor(route: Route): ReactNode {
  switch (route.name) {
    case "onboarding":
      return <Onboarding step={route.step} />;
    case "home":
      return <Home />;
    case "clarify":
      return <Clarify />;
    case "plan":
      return <Plan />;
    case "call":
      return <Call key={route.callId} callId={route.callId} />;
    case "result":
      return <Result callId={route.callId} />;
    case "settings":
      return <Settings />;
    case "privacy":
      return <Privacy />;
    case "notFound":
      return <Redirect to={HOME} />;
  }
}

function Shell() {
  const { d } = useT();
  useApplyTheme();
  const calm = useCalm();
  return (
    // Calm mode keeps fades but drops movement, scale and layout morphs.
    <MotionConfig reducedMotion={calm ? "always" : "never"}>
    <AlertProvider>
      <a
        className="sp-skip"
        href="#main"
        onClick={(e) => {
          // Hash routing owns location.hash, so move focus without navigating.
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {d.app.skip}
      </a>
      {IS_MOCK ? (
        <p className="sp-mockbadge" role="note">
          {d.app.mockBadge}
        </p>
      ) : null}
      <Stage />
    </AlertProvider>
    </MotionConfig>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
