import { runTool } from "../tools/index.js";
import { compactToolResult } from "../compact-tool-result.js";

export type VapiToolCall = {
  id: string;
  name: string;
  parameters?: Record<string, unknown>;
};

export type VapiToolCallsBody = {
  message?: {
    type?: string;
    toolCallList?: unknown[];
    toolCalls?: unknown[];
    toolWithToolCallList?: unknown[];
  };
};

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return {};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** Normalize Vapi's varying tool-call payload shapes (OpenAI-style function blocks, arguments vs parameters). */
function normalizeRawToolCall(raw: unknown): VapiToolCall | null {
  const item = asRecord(raw);
  if (!item) return null;

  const toolCall = asRecord(item.toolCall);
  const fn = asRecord(item.function) ?? asRecord(toolCall?.function);

  const id = String(item.id ?? item.toolCallId ?? toolCall?.id ?? "");
  const name = String(item.name ?? fn?.name ?? toolCall?.name ?? "");

  if (!id || !name) return null;

  const argSources = [
    item.arguments,
    item.parameters,
    fn?.arguments,
    fn?.parameters,
    toolCall?.arguments,
    toolCall?.parameters,
  ];

  let parameters: Record<string, unknown> = {};
  for (const source of argSources) {
    const parsed = parseArguments(source);
    if (Object.keys(parsed).length > 0) {
      parameters = parsed;
      break;
    }
  }

  return { id, name, parameters };
}

function extractToolCalls(body: VapiToolCallsBody): VapiToolCall[] {
  const message = body.message;
  if (!message) return [];

  const rawItems: unknown[] = [
    ...(message.toolCallList ?? []),
    ...(message.toolCalls ?? []),
  ];

  for (const item of message.toolWithToolCallList ?? []) {
    const record = asRecord(item);
    if (record?.toolCall) {
      rawItems.push(record.toolCall);
    }
    rawItems.push(item);
  }

  const seen = new Set<string>();
  const calls: VapiToolCall[] = [];

  for (const raw of rawItems) {
    const call = normalizeRawToolCall(raw);
    if (!call || seen.has(call.id)) continue;
    seen.add(call.id);
    calls.push(call);
  }

  return calls;
}

function normalizeArgs(params: Record<string, unknown> | undefined): Record<string, string> {
  if (!params) return {};
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    args[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return args;
}

export async function handleVapiToolCalls(body: VapiToolCallsBody) {
  const toolCalls = extractToolCalls(body);
  const results = [];

  for (const call of toolCalls) {
    try {
      const output = await runTool(call.name, normalizeArgs(call.parameters));
      results.push({
        toolCallId: call.id,
        result: toSingleLine(compactToolResult(call.name, output)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tool execution failed";
      results.push({ toolCallId: call.id, error: toSingleLine(message) });
    }
  }

  if (toolCalls.length === 0) {
    console.warn("[vapi/tools] no tool calls parsed from payload:", JSON.stringify(body.message));
  }

  return { results };
}
