// Optional phone-number accounts: a 6-digit SMS code, then a 30-day session token.
// Server-owned (no Supabase Auth). Codes live in memory only, salted+hashed, 10 min, 5 tries.
// Without VONAGE_API_KEY/SECRET (or in mock mode) the code is logged to the console instead.

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { config } from "./config.ts";
import { isDeviceId, type Db } from "./db.ts";
import { normalizePhone } from "./safety.ts";
import { vonageJwt } from "./call/vonage-line.ts";

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_TRIES = 5;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const PER_PHONE = { max: 3, windowMs: 10 * 60_000 };
const PER_IP = { max: 10, windowMs: 3600_000 };

/** Sends one SMS. Returns "sms" when sent, "dev" when only logged. Throws with a readable message on failure. */
export type SmsSender = (e164: string, text: string) => Promise<"sms" | "dev">;

export function vonageSms(f: typeof fetch = fetch): SmsSender {
  return async (e164, text) => {
    const key = process.env.VONAGE_API_KEY;
    const secret = process.env.VONAGE_API_SECRET;
    const app = config.vonage;
    // No API secret, but the voice app's key works: send through the Messages API (JWT).
    // Needs the Messages capability turned on for the Vonage application.
    if ((!key || !secret) && app.applicationId && app.privateKey && config.callProvider !== "mock") {
      let r: Response;
      try {
        r = await f("https://api.nexmo.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${vonageJwt(app.applicationId, app.privateKey)}` },
          body: JSON.stringify({ message_type: "text", channel: "sms", to: e164.slice(1), from: "Spoken", text }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new Error("Fikk ikke sendt SMS (ingen kontakt med SMS-tjenesten).");
      }
      if (!r.ok) {
        console.warn(`[auth] Messages API SMS failed: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
        throw new Error("Fikk ikke sendt SMS. Prøv igjen om litt.");
      }
      return "sms";
    }
    if (!key || !secret || config.callProvider === "mock") {
      console.log(`[auth] dev mode, no SMS sent to ${e164}: ${text}`);
      return "dev";
    }
    let res: Response;
    try {
      res = await f("https://rest.nexmo.com/sms/json", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ api_key: key, api_secret: secret, from: "Spoken", to: e164.slice(1), text }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new Error("Fikk ikke sendt SMS (ingen kontakt med SMS-tjenesten).");
    }
    const data = (await res.json().catch(() => null)) as { messages?: { status?: string; "error-text"?: string }[] } | null;
    const m = data?.messages?.[0];
    if (!res.ok || !m || m.status !== "0") {
      console.warn(`[auth] SMS failed: HTTP ${res.status} status ${m?.status ?? "?"} ${m?.["error-text"] ?? ""}`);
      throw new Error("Fikk ikke sendt SMS. Prøv igjen om litt.");
    }
    return "sms";
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHash = (salt: string, code: string) => sha256(`${salt}:${code}`);

export type AuthResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export interface Me {
  phone: string;
  accountId: string;
  /** The key all of this account's data is stored under. */
  device: string;
}

export function createAuth(db: Db, opts: { sms?: SmsSender; now?: () => number } = {}) {
  const sms = opts.sms ?? vonageSms();
  const now = opts.now ?? Date.now;
  const codes = new Map<string, { salt: string; hash: string; expires: number; tries: number }>();
  const hits = new Map<string, number[]>();

  /** Counts a hit and says whether the key is already over its limit. */
  function limited(key: string, max: number, windowMs: number): boolean {
    const recent = (hits.get(key) ?? []).filter((t) => now() - t < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return true; }
    recent.push(now());
    hits.set(key, recent);
    return false;
  }

  function cleanPhone(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const e164 = normalizePhone(raw);
    return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
  }

  return {
    async start(rawPhone: unknown, ip: string): Promise<AuthResult<{ sent: "sms" | "dev" }>> {
      const phone = cleanPhone(rawPhone);
      if (!phone) return fail(400, "Ugyldig telefonnummer.");
      if (limited(`ip:${ip}`, PER_IP.max, PER_IP.windowMs) || limited(`phone:${phone}`, PER_PHONE.max, PER_PHONE.windowMs)) {
        return fail(429, "For mange forsøk. Prøv igjen senere.");
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const salt = randomBytes(8).toString("hex");
      let sent: "sms" | "dev";
      try {
        sent = await sms(phone, `Spoken-kode: ${code}`);
      } catch (e) {
        return fail(502, (e as Error).message);
      }
      codes.set(phone, { salt, hash: codeHash(salt, code), expires: now() + CODE_TTL_MS, tries: 0 });
      return { ok: true, value: { sent } };
    },

    async verify(rawPhone: unknown, rawCode: unknown, rawDevice: unknown): Promise<AuthResult<{ token: string; phone: string; expiresAt: string; device: string }>> {
      const phone = cleanPhone(rawPhone);
      if (!phone) return fail(400, "Ugyldig telefonnummer.");
      if (typeof rawDevice !== "string" || !isDeviceId(rawDevice)) return fail(400, "device (a UUID) is required");
      const device = rawDevice.toLowerCase();
      const code = typeof rawCode === "string" ? rawCode.trim() : "";
      const entry = codes.get(phone);
      if (!entry || entry.expires <= now()) {
        codes.delete(phone);
        return fail(400, "Koden er utløpt. Be om en ny.");
      }
      if (entry.tries >= MAX_TRIES) return fail(429, "For mange feil. Be om en ny kode.");
      entry.tries++;
      const given = Buffer.from(codeHash(entry.salt, code));
      const want = Buffer.from(entry.hash);
      if (!/^\d{6}$/.test(code) || !timingSafeEqual(given, want)) {
        if (entry.tries >= MAX_TRIES) {
          codes.delete(phone);
          return fail(429, "For mange feil. Be om en ny kode.");
        }
        return fail(400, `Feil kode. ${MAX_TRIES - entry.tries} forsøk igjen.`);
      }
      codes.delete(phone);

      const account = await db.upsertAccount(phone, device);
      // Whatever this device collected while anonymous joins the account's data.
      await db.mergeDevice(device, account.primaryDevice);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now() + SESSION_TTL_MS).toISOString();
      await db.createSession(sha256(token), account.id, expiresAt);
      return { ok: true, value: { token, phone, expiresAt, device: account.primaryDevice } };
    },

    /** The account behind an Authorization header, or null (no/bad/expired token). */
    async resolve(authorization: string | null): Promise<Me | null> {
      const m = authorization?.match(/^Bearer\s+([\w-]{20,100})$/i);
      if (!m) return null;
      const h = sha256(m[1]!);
      const s = await db.getSession(h);
      if (!s) return null;
      if (Date.parse(s.expiresAt) <= now()) {
        await db.deleteSession(h);
        return null;
      }
      return { phone: s.phone, accountId: s.id, device: s.primaryDevice };
    },

    async logout(authorization: string | null): Promise<void> {
      const m = authorization?.match(/^Bearer\s+([\w-]{20,100})$/i);
      if (m) await db.deleteSession(sha256(m[1]!));
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
