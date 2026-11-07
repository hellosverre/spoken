// One-time (idempotent) setup of everything the spike needs, without touching any existing
// agent, number or connection:
//   1. Telnyx: a NEW FQDN connection (credential auth; the account is capped at 1 credential connection) "spoken-eleven" (outbound only, caller ID = our number)
//   2. ElevenLabs: the server tool, the agent, and a SIP-trunk phone number pointing at (1)
// IDs go to server/.cache/eleven-agent.json (gitignored). Passwords are generated and passed
// straight to the two APIs; they are never printed or stored.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { eleven, telnyx } from "./api.ts";
import { AGENT_NAME, DEFAULT_VARS, FIRST_MESSAGE, PROMPT, TOOL_DESCRIPTION } from "./prompt.ts";

const STATE = join(import.meta.dir, "../../../.cache/eleven-agent.json");

export interface SpikeState {
  toolId?: string;
  toolSecret?: string; // shared secret the tool webhook must present
  agentId?: string;
  phoneNumberId?: string;
  telnyxConnectionId?: string;
  telnyxUser?: string;
}

export function loadState(): SpikeState {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
}
function save(s: SpikeState) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

const rand = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, n * 2);

export interface ProvisionOpts {
  publicUrl: string;
  fromNumber: string; // E.164, owned by the Telnyx account (forced as caller ID by the connection)
  elevenNumber?: string; // placeholder identity inside ElevenLabs
  llm?: string;
  voiceId?: string;
  maxCallSec?: number;
}

export function agentConfig(o: ProvisionOpts, toolId: string) {
  return {
    platform_settings: { overrides: { conversation_config_override: { conversation: { text_only: true } } } },
    name: AGENT_NAME,
    tags: ["spoken", "spike"],
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "no",
        dynamic_variables: { dynamic_variable_placeholders: DEFAULT_VARS },
        prompt: {
          prompt: PROMPT,
          llm: o.llm ?? "claude-haiku-5-5",
          temperature: 0.3,
          tool_ids: [toolId],
          built_in_tools: { end_call: { name: "end_call", description: "Avslutt samtalen når oppdraget er løst, ikke kan løses, eller motparten ber om det." } },
        },
      },
      tts: {
        model_id: "eleven_flash_v2_5",
        voice_id: o.voiceId ?? "nPczCjzI2devNBz1zQrb",
        agent_output_audio_format: "ulaw_8000",
        stability: 0.7,
        speed: 0.92,
      },
      asr: { user_input_audio_format: "ulaw_8000" },
      turn: { turn_timeout: 6, turn_eagerness: "normal" },
      conversation: { max_duration_seconds: o.maxCallSec ?? 150 },
    },
  };
}

export async function provision(o: ProvisionOpts): Promise<SpikeState> {
  const s = loadState();

  // 1. Telnyx FQDN connection (new; the existing "bas" one is left alone). The password is
  // rotated whenever the ElevenLabs number is (re)imported, so it never needs storing.
  if (!s.phoneNumberId) {
    const password = rand(12);
    const outbound = { outbound_voice_profile_id: "", ani_override: o.fromNumber, ani_override_type: "always", channel_limit: 2 };
    if (!s.telnyxConnectionId) {
      const profiles = await telnyx.get("/outbound_voice_profiles");
      outbound.outbound_voice_profile_id = profiles.data?.[0]?.id;
      if (!outbound.outbound_voice_profile_id) throw new Error("no Telnyx outbound voice profile");
      s.telnyxUser = `spokeneleven${rand(4)}`;
      const c = await telnyx.post("/fqdn_connections", {
        connection_name: "spoken-eleven",
        user_name: s.telnyxUser,
        password,
        active: true,
        transport_protocol: "TCP",
        inbound: { sip_subdomain_receive_settings: "only_my_connections" },
        outbound,
      });
      s.telnyxConnectionId = c.data.id;
    } else {
      await telnyx.patch(`/fqdn_connections/${s.telnyxConnectionId}`, { password });
    }
    save(s);
    // 3. ElevenLabs SIP-trunk number, outbound via Telnyx termination.
    const n = await eleven.post("/v1/convai/phone-numbers", {
      provider: "sip_trunk",
      label: "Spoken spike (Telnyx)",
      // +17733408724 is already imported in another ElevenLabs workspace (one import per number).
      // The Telnyx connection forces the real caller ID (ani_override "always"), so this is only a label.
      phone_number: o.elevenNumber ?? `+4420794${String(60000 + Math.floor(Math.random() * 999)).padStart(5, "0")}`,
      outbound_trunk_config: {
        address: "sip.telnyx.com",
        transport: "tcp",
        media_encryption: "allowed",
        credentials: { username: s.telnyxUser, password },
        enabled_codecs: ["PCMU/8000", "PCMA/8000"],
      },
    });
    s.phoneNumberId = n.phone_number_id;
    save(s);
  }

  // 2. Tool: blocks until the app's JA/NEI arrives. Long timeout on purpose.
  s.toolSecret ??= rand(16);
  const tool = {
    tool_config: {
      type: "webhook",
      name: "ask_user_approval",
      description: TOOL_DESCRIPTION,
      response_timeout_secs: 120,
      api_schema: {
        url: `${o.publicUrl}/eleven/tool/approval`,
        method: "POST",
        request_headers: { "x-spoken-secret": s.toolSecret },
        request_body_schema: {
          type: "object",
          required: ["conversation_id", "question"],
          properties: {
            conversation_id: { type: "string", dynamic_variable: "system__conversation_id" },
            question: { type: "string", description: "Kort spørsmål til brukeren, f.eks. «Stor pepperoni for 189 kr, hentes 18:00. Skal jeg bestille?»" },
            options: { type: "string", description: "Svaralternativer skilt med komma, f.eks. «JA,NEI»" },
          },
        },
      },
    },
  };
  if (s.toolId) await eleven.patch(`/v1/convai/tools/${s.toolId}`, tool);
  else s.toolId = (await eleven.post("/v1/convai/tools", tool)).id;
  save(s);

  // 4. Agent.
  const cfg = agentConfig(o, s.toolId!);
  if (s.agentId) await eleven.patch(`/v1/convai/agents/${s.agentId}`, cfg);
  else s.agentId = (await eleven.post("/v1/convai/agents/create", cfg)).agent_id;
  save(s);
  return s;
}
