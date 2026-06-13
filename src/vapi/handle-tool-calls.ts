import { runTool } from "../tools/index.js";

export type VapiToolCall = {
  id: string;
  name: string;
  parameters?: Record<string, unknown>;
};

export type VapiToolCallsBody = {
  message?: {
    type?: string;
    toolCallList?: VapiToolCall[];
    toolWithToolCallList?: Array<{
      name: string;
      toolCall: { id: string; parameters?: Record<string, unknown> };
    }>;
  };
};

function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function extractToolCalls(body: VapiToolCallsBody): VapiToolCall[] {
  const fromList = body.message?.toolCallList ?? [];
  if (fromList.length) return fromList;

  return (
    body.message?.toolWithToolCallList?.map((item) => ({
      id: item.toolCall.id,
      name: item.name,
      parameters: item.toolCall.parameters,
    })) ?? []
  );
}

export async function handleVapiToolCalls(body: VapiToolCallsBody) {
  const toolCalls = extractToolCalls(body);
  const results = [];

  for (const call of toolCalls) {
    try {
      const output = await runTool(call.name, normalizeArgs(call.parameters));
      results.push({ toolCallId: call.id, result: toSingleLine(output) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Tool execution failed";
      results.push({ toolCallId: call.id, error: toSingleLine(message) });
    }
  }

  return { results };
}
