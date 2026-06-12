import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionToolMessageParam } from "groq-sdk/resources/chat/completions";
import { SYSTEM_POLICY } from "./policy.js";
import { toolDefinitions, runTool } from "./tools/index.js";

const MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const MAX_TOOL_ROUNDS = 10;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function chat(userMessage: string, history: ChatCompletionMessageParam[]): Promise<string> {
  history.push({ role: "user", content: userMessage });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_POLICY }, ...history],
      tools: toolDefinitions,
      tool_choice: "auto",
    });

    const choice = response.choices[0]?.message;
    if (!choice) return "Sorry, I didn't get a response. Please try again.";

    history.push(choice);

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      return choice.content ?? "Sorry, I didn't get a response. Please try again.";
    }

    for (const toolCall of toolCalls) {
      const fn = toolCall.function;
      let args: Record<string, string> = {};
      try {
        args = JSON.parse(fn.arguments);
      } catch {
        args = {};
      }

      const result = await runTool(fn.name, args);
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

export function createHistory(): ChatCompletionMessageParam[] {
  return [];
}
