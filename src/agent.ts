import Groq from "groq-sdk";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "groq-sdk/resources/chat/completions";
import { SYSTEM_POLICY, OPENING_GREETING, buildSystemPrompt } from "./policy.js";
import { runTool } from "./tools/index.js";
import { compactToolResult } from "./compact-tool-result.js";
import {
  getActiveTools,
  getToolStatusMessage,
  getWorkingStatusMessage,
  schedulingPolicyAddon,
  shouldRequireTools,
} from "./tool-routing.js";

const USE_OPENROUTER = process.env.LLM_PROVIDER === "openrouter";

const GROQ_MODEL = process.env.GROQ_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-oss-120b:free";

export const MODEL = USE_OPENROUTER ? OPENROUTER_MODEL : GROQ_MODEL;
const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS = 120;

const llm = new Groq({
  apiKey: USE_OPENROUTER
    ? process.env.OPENROUTER_API_KEY
    : process.env.GROQ_API_KEY,
  baseURL: USE_OPENROUTER
    ? "https://openrouter.ai/api/v1"
    : undefined,
});

async function callGroq(
  history: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] | undefined,
  toolChoice: "auto" | "required",
  extraSystem = "",
) {
  return llm.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "system", content: buildSystemPrompt(SYSTEM_POLICY + extraSystem) }, ...history],
    ...(tools?.length ? { tools, tool_choice: toolChoice } : {}),
  });
}

export function createHistory(): ChatCompletionMessageParam[] {
  return [{ role: "assistant", content: OPENING_GREETING }];
}

export function getOpeningGreeting(): string {
  return OPENING_GREETING;
}

export type ChatStatusCallback = (message: string) => void;

export async function chat(
  userMessage: string,
  history: ChatCompletionMessageParam[],
  onStatus?: ChatStatusCallback,
): Promise<string> {
  console.log("[chat] user:", userMessage);
  history.push({ role: "user", content: userMessage });

  const tools = getActiveTools(history, userMessage);
  const extraSystem = schedulingPolicyAddon(tools);
  let requireTools = shouldRequireTools(userMessage, history);

  let statusShown = false;
  const emitStatus = (message: string | undefined) => {
    if (!message || statusShown) return;
    statusShown = true;
    onStatus?.(message);
  };

  emitStatus(getWorkingStatusMessage(userMessage, history));

  let anyToolCalled = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    let response;
    try {
      response = await callGroq(
        history,
        tools,
        requireTools && tools?.length ? "required" : "auto",
        extraSystem,
      );
    } catch (err: unknown) {
      const groqErr = err as { error?: { error?: { code?: string; failed_generation?: string } } };
      if (groqErr?.error?.error?.code === "tool_use_failed" && groqErr.error.error.failed_generation) {
        const fallback = groqErr.error.error.failed_generation;
        console.log("[chat] tool_use_failed, using failed_generation:", fallback);
        history.push({ role: "assistant", content: fallback });
        return fallback;
      }
      throw err;
    }

    const choice = response.choices[0]?.message;
    if (!choice) return "Sorry, I didn't get a response. Please try again.";

    history.push(choice);

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      if (requireTools && tools?.length && round === 0) {
        requireTools = false;
        continue;
      }
      const reply = choice.content ?? "";

      if (
        !anyToolCalled &&
        /\b(booked|confirmed your|cancelled|rescheduled|moved your)\b/i.test(reply)
      ) {
        console.warn("[chat] BLOCKED fabricated action — model claimed action without tool call:", reply);
        history.pop();
        history.push({
          role: "assistant",
          content: "Let me look that up for you — one moment.",
        });
        requireTools = true;
        continue;
      }

      console.log("[chat] reply:", reply);
      return reply || "Sorry, I didn't get a response. Please try again.";
    }

    requireTools = false;
    anyToolCalled = true;

    for (const toolCall of toolCalls) {
      const fn = toolCall.function;
      emitStatus(getToolStatusMessage(fn.name));

      let args: Record<string, string> = {};
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        args = {};
      }

      console.log("[chat] tool call:", fn.name, JSON.stringify(args));
      const result = compactToolResult(fn.name, await runTool(fn.name, args));
      console.log("[chat] tool result:", fn.name, result);
      const toolMessage: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      };
      history.push(toolMessage);
    }
  }

  return "Sorry, I ran into an issue processing your request. Please try again.";
}
