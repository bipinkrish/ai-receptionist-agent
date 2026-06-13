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

export const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS = 120;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function callGroq(
  history: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] | undefined,
  toolChoice: "auto" | "required",
  extraSystem = "",
) {
  return groq.chat.completions.create({
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callGroq(
      history,
      tools,
      requireTools && tools?.length ? "required" : "auto",
      extraSystem,
    );

    const choice = response.choices[0]?.message;
    if (!choice) return "Sorry, I didn't get a response. Please try again.";

    history.push(choice);

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      if (requireTools && tools?.length && round === 0) {
        requireTools = false;
        continue;
      }
      return choice.content ?? "Sorry, I didn't get a response. Please try again.";
    }

    requireTools = false;

    for (const toolCall of toolCalls) {
      const fn = toolCall.function;
      emitStatus(getToolStatusMessage(fn.name));

      let args: Record<string, string> = {};
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        args = {};
      }

      const result = compactToolResult(fn.name, await runTool(fn.name, args));
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
