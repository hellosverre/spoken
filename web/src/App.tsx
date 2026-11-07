import { IS_MOCK } from "./api/index.ts";
import { useT } from "./i18n/useT.ts";
import { AlertProvider } from "./lib/alerts.tsx";
import { Redirect, useRoute, type Route } from "./lib/router.tsx";
import { useApplyTheme } from "./lib/useApplyTheme.ts";
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

function Screens() {
  const route = useRoute();
  const { state } = useStore();

  // Privacy is readable before onboarding; everything else needs it done.
  if (!state.onboarded && route.name !== "onboarding" && route.name !== "privacy") return <Redirect to={ONBOARDING} />;

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
  return (
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
      <Screens />
    </AlertProvider>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
