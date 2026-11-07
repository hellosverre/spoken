// Thin ElevenLabs Agents + Telnyx REST client for the spike. Keys come from env
// (bas-secret run); they are never logged or written anywhere.

const EL = "https://api.elevenlabs.io";
const TX = "https://api.telnyx.com/v2";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (run through bas-secret)`);
  return v.trim();
}

async function call<T = any>(base: string, path: string, init: RequestInit & { key: [string, string] }): Promise<T> {
  const { key, ...rest } = init;
  const res = await fetch(base + path, {
    ...rest,
    headers: { [key[0]]: key[1], "Content-Type": "application/json", ...(rest.headers as object) },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${rest.method ?? "GET"} ${path} → HTTP ${res.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const body = (o: unknown) => JSON.stringify(o);

export const eleven = {
  get: <T = any>(p: string) => call<T>(EL, p, { key: ["xi-api-key", need("ELEVENLABS_API_KEY")] }),
  post: <T = any>(p: string, b: unknown) => call<T>(EL, p, { method: "POST", body: body(b), key: ["xi-api-key", need("ELEVENLABS_API_KEY")] }),
  patch: <T = any>(p: string, b: unknown) => call<T>(EL, p, { method: "PATCH", body: body(b), key: ["xi-api-key", need("ELEVENLABS_API_KEY")] }),
  del: <T = any>(p: string) => call<T>(EL, p, { method: "DELETE", key: ["xi-api-key", need("ELEVENLABS_API_KEY")] }),
};

export const telnyx = {
  get: <T = any>(p: string) => call<T>(TX, p, { key: ["Authorization", `Bearer ${need("TELNYX_API_KEY")}`] }),
  patch: <T = any>(p: string, b: unknown) => call<T>(TX, p, { method: "PATCH", body: body(b), key: ["Authorization", `Bearer ${need("TELNYX_API_KEY")}`] }),
  post: <T = any>(p: string, b: unknown) => call<T>(TX, p, { method: "POST", body: body(b), key: ["Authorization", `Bearer ${need("TELNYX_API_KEY")}`] }),
};
