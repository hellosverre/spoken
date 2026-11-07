import { useEffect, useState } from "react";

// Hash routing: works from any static host (Vercel, file preview) with no rewrites.

export type Route =
  | { name: "onboarding"; step: 1 | 2 | 3 }
  | { name: "home" }
  | { name: "clarify" }
  | { name: "plan" }
  | { name: "call"; callId: string }
  | { name: "result"; callId: string }
  | { name: "settings" }
  | { name: "privacy" }
  | { name: "notFound" };

export function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  switch (parts[0]) {
    case undefined:
      return { name: "home" };
    case "onboarding": {
      const n = Number(parts[1] ?? 1);
      return { name: "onboarding", step: n === 2 || n === 3 ? n : 1 };
    }
    case "clarify":
      return { name: "clarify" };
    case "plan":
      return { name: "plan" };
    case "call":
      return parts[1] ? { name: "call", callId: decodeURIComponent(parts[1]) } : { name: "notFound" };
    case "result":
      return parts[1] ? { name: "result", callId: decodeURIComponent(parts[1]) } : { name: "notFound" };
    case "settings":
      return { name: "settings" };
    case "privacy":
      return { name: "privacy" };
    default:
      return { name: "notFound" };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case "onboarding":
      return `#/onboarding/${route.step}`;
    case "home":
      return "#/";
    case "call":
    case "result":
      return `#/${route.name}/${encodeURIComponent(route.callId)}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const target = href(route);
  if (opts.replace) {
    history.replaceState(null, "", target);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = target;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", on);
    // A child <Redirect> may have changed the hash before this listener existed.
    on();
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Navigates after render (never during it), replacing the current entry. */
export function Redirect({ to }: { to: Route }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}
