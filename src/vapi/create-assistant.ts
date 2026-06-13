import dotenv from "dotenv";
import { MODEL } from "../agent.js";
import { VOICE_POLICY, VOICE_FIRST_MESSAGE, buildSystemPrompt } from "../policy.js";
import { buildAssistantTools } from "./tools.js";

dotenv.config();

const VAPI_API = "https://api.vapi.ai";
const privateKey = process.env.VAPI_PRIVATE_KEY;
const apiBase = process.env.API_BASE_URL?.replace(/\/$/, "");
const toolServerUrl =
  process.env.TOOL_SERVER_URL ?? (apiBase ? `${apiBase}/vapi/tools` : undefined);
const assistantId = process.env.VAPI_ASSISTANT_ID;
const USE_OPENROUTER = process.env.LLM_PROVIDER === "openrouter";
const openrouterApiKey = process.env.OPENROUTER_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

if (!privateKey) {
  console.error("Missing VAPI_PRIVATE_KEY");
  process.exit(1);
}
if (!toolServerUrl) {
  console.error("Missing TOOL_SERVER_URL or API_BASE_URL (defaults to API_BASE_URL/vapi/tools)");
  process.exit(1);
}

async function vapiFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${VAPI_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${privateKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`Vapi ${init.method ?? "GET"} ${path} failed (${res.status}): ${text}`);
  }

  return data as Record<string, unknown>;
}

async function ensureLlmCredential() {
  if (USE_OPENROUTER) {
    if (!openrouterApiKey) {
      console.warn("OPENROUTER_API_KEY not set — assuming OpenRouter is configured in the Vapi dashboard.");
      return;
    }
    try {
      await vapiFetch("/credential", {
        method: "POST",
        body: JSON.stringify({ provider: "openrouter", apiKey: openrouterApiKey, name: "solstice-openrouter" }),
      });
      console.log("OpenRouter credential added to Vapi.");
    } catch (err) {
      console.warn("OpenRouter credential step skipped:", err instanceof Error ? err.message : err);
    }
  } else {
    if (!groqApiKey) {
      console.warn("GROQ_API_KEY not set — assuming Groq is configured in the Vapi dashboard.");
      return;
    }
    try {
      await vapiFetch("/credential", {
        method: "POST",
        body: JSON.stringify({ provider: "groq", apiKey: groqApiKey, name: "solstice-groq" }),
      });
      console.log("Groq credential added to Vapi.");
    } catch (err) {
      console.warn("Groq credential step skipped:", err instanceof Error ? err.message : err);
    }
  }
}

function buildAssistantPayload() {
  return {
    name: "Solstice Pilates Receptionist",
    firstMessage: VOICE_FIRST_MESSAGE,
    model: {
      provider: USE_OPENROUTER ? "openrouter" : "groq",
      model: MODEL,
      temperature: 0.2,
      maxTokens: USE_OPENROUTER ? 80 : 60,
      messages: [
        { role: "system", content: buildSystemPrompt(VOICE_POLICY) },
      ],
      tools: buildAssistantTools(toolServerUrl!),
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-2-phonecall",
      language: "en-US",
      smartFormat: true,
      keywords: [
        "Solstice:3",
        "Pilates:3",
        "reschedule:2",
        "cancel:2",
        "session:2",
        "booking:2",
        "minutes:2",
      ],
    },
    voice: {
      provider: "vapi",
      voiceId: "Emma",
      version: 2,
    },
    server: {
      url: toolServerUrl,
    },
  };
}

async function main() {
  await ensureLlmCredential();

  const payload = buildAssistantPayload();

  if (assistantId) {
    const updated = await vapiFetch(`/assistant/${assistantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    console.log("Assistant updated:", updated.id ?? assistantId);
    return;
  }

  const created = await vapiFetch("/assistant", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  console.log("\nAssistant created.");
  console.log("ID:", created.id);
  console.log("\nAdd to .env:");
  console.log(`VAPI_ASSISTANT_ID=${created.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
