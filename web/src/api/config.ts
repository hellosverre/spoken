// Where the server lives. With no VITE_API_URL (or VITE_MOCK=1) the app runs the
// in-browser mock, so the full flow works with no server at all.
const env = import.meta.env;

// "/" = the server that serves this page (the Bun call server hosts the built app).
const rawApi = env.VITE_API_URL === "/" ? window.location.origin : (env.VITE_API_URL ?? "");
export const API_URL: string = rawApi.replace(/\/$/, "");
export const WS_URL: string = (env.VITE_WS_URL ?? deriveWs(API_URL)).replace(/\/$/, "");
export const IS_MOCK: boolean = env.VITE_MOCK === "1" || API_URL === "";

function deriveWs(api: string): string {
  if (!api) return "";
  return api.replace(/^http/, "ws");
}
