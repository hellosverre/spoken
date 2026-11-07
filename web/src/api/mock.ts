import type {
  CallResult,
  Clarify,
  Plan,
  Profile,
  Question,
  TaskInput,
  Voice,
} from "../../../shared/contract.ts";
import { startMockCall } from "./mockCall.ts";
import { ApiError, type Api } from "./types.ts";

// In-browser stand-in for the server, used until the server branch lands
// and for the offline demo. Same shapes, same safety rules on the surface.

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const VOICES: Voice[] = [
  { id: "mock-voice-ingrid", name: "Ingrid", description: "Warm, calm, eastern Norwegian", preset: true },
  { id: "mock-voice-jonas", name: "Jonas", description: "Clear, friendly, a little slow", preset: true },
  { id: "mock-voice-sol", name: "Sol", description: "Bright, brisk, gets to the point", preset: true },
];

const EMERGENCY = /\b(110|112|113)\b/;

interface TaskState {
  input: TaskInput;
  answers?: Record<string, string>;
}

const tasks = new Map<string, TaskState>();
const results = new Map<string, CallResult>();
const calls = new Map<string, string>(); // callId → taskId
const voices = [...VOICES];
let profile: Profile = { name: "", hearCall: false, personality: "warm", lang: "en" };

function questionsFor(input: TaskInput): Question[] {
  const en = input.lang === "en";
  if (/pizza|pepperoni|domino/i.test(input.text)) {
    return [
      {
        id: "pickup",
        text: en ? "Pickup or delivery?" : "Henting eller levering?",
        options: en ? ["Pickup", "Delivery"] : ["Henting", "Levering"],
      },
      {
        id: "extra",
        text: en ? "Anything to add to the order?" : "Noe mer på bestillingen?",
        options: en ? ["No, that's all", "Extra cheese", "A large Coke"] : ["Nei, det er alt", "Ekstra ost", "En stor Cola"],
      },
    ];
  }
  return [
    {
      id: "when",
      text: en ? "When suits you?" : "Når passer det?",
      options: en ? ["As soon as possible", "This week", "Next week"] : ["Så fort som mulig", "Denne uka", "Neste uke"],
    },
    { id: "notes", text: en ? "Anything they should know?" : "Noe de bør vite?" },
  ];
}

function calleeFor(input: TaskInput): Plan["callee"] {
  if (input.phone) return { name: input.phone, phone: input.phone, source: "user" };
  if (/domino/i.test(input.text)) return { name: "Domino's Storo", phone: "+4722150000", source: "lookup" };
  return { name: input.lang === "en" ? "Looked-up business" : "Oppslått bedrift", phone: "+4723000000", source: "lookup" };
}

export const mockApi: Api = {
  async createTask(input) {
    await delay(700);
    if (!input.text.trim()) throw new ApiError("Task text is empty", 400);
    const taskId = id("task");
    tasks.set(taskId, { input });
    const clarify: Clarify = {
      taskId,
      summary:
        input.lang === "en"
          ? `Call and ${input.text.charAt(0).toLowerCase()}${input.text.slice(1)}`
          : `Ringe og ${input.text.charAt(0).toLowerCase()}${input.text.slice(1)}`,
      questions: questionsFor(input),
    };
    return clarify;
  },

  async answer(taskId, answers) {
    await delay(800);
    const task = tasks.get(taskId);
    if (!task) throw new ApiError("Unknown task", 404);
    task.answers = answers;
    const en = task.input.lang === "en";
    const name = profile.name || (en ? "the user" : "brukeren");
    const plan: Plan = {
      taskId,
      callee: calleeFor(task.input),
      goal: task.input.text,
      opening: `Hei, jeg er en KI-assistent som ringer på vegne av ${name}. Du kan si nei til å snakke med meg.`,
      willShare: ["name"],
      needsApprovalFor: en
        ? ["Any price over 0 kr", "Booking or changing a time"]
        : ["Pris over 0 kr", "Booke eller endre en time"],
      voiceId: profile.voiceId ?? VOICES[0].id,
    };
    const match = EMERGENCY.exec(task.input.text + " " + (task.input.phone ?? ""));
    if (match) {
      plan.blocked = en
        ? { reason: `Spoken can't call ${match[1]}. Emergency calls need you on the line.`, alternative: `Text 113 via the emergency SMS service, or call ${match[1]} directly.` }
        : { reason: `Spoken kan ikke ringe ${match[1]}. Nødsamtaler må du ta selv.`, alternative: `Send SMS til nødmeldetjenesten, eller ring ${match[1]} direkte.` };
    }
    return plan;
  },

  async startCall(taskId) {
    await delay(400);
    if (!tasks.has(taskId)) throw new ApiError("Unknown task", 404);
    const callId = id("call");
    calls.set(callId, taskId);
    return { callId };
  },

  async hangup() {
    await delay(150);
    return { ok: true };
  },

  async getCall(callId) {
    await delay(200);
    const result = results.get(callId);
    if (!result) throw new ApiError("Call has no result yet", 404);
    return result;
  },

  async voices() {
    await delay(300);
    return [...voices];
  },

  async designVoice(description) {
    await delay(1400);
    const v: Voice = { id: id("voice"), name: description.split(/[,.]/)[0].slice(0, 24) || "Custom", description, preset: false };
    voices.push(v);
    return v;
  },

  async getProfile() {
    await delay(100);
    return { ...profile };
  },

  async putProfile(p) {
    await delay(150);
    profile = { ...p };
    return { ...profile };
  },

  live(callId, handlers) {
    const taskId = calls.get(callId) ?? "";
    const lang = tasks.get(taskId)?.input.lang ?? profile.lang;
    const params = new URLSearchParams(location.search);
    const speed = Number(params.get("mockSpeed")) || 1;
    return startMockCall(
      {
        callId,
        taskId,
        name: profile.name || (lang === "en" ? "the user" : "brukeren"),
        lang,
        speed,
        levels: params.get("mockLevels") === "1",
        onResult: (r) => results.set(callId, r),
      },
      handlers,
    );
  },
};
