import { runTool } from "../tools/index.js";
import { compactToolResult } from "../compact-tool-result.js";
import { isUsablePhone, validateCallerPhone } from "../tools/caller-identity.js";
import { scheduleEndCall } from "./end-call.js";

export type VapiToolCall = {
  id: string;
  name: string;
  parameters?: Record<string, unknown>;
};

export type VapiToolCallsBody = {
  message?: {
    type?: string;
    call?: {
      id?: string;
      customer?: { number?: string; phoneNumber?: string; name?: string };
    };
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

function logContactSucceeded(output: string): boolean {
  try {
    const parsed = JSON.parse(output) as { success?: boolean };
    return parsed.success === true;
  } catch {
    return output.toLowerCase().includes("logged");
  }
}

function extractVapiCallerContext(body: VapiToolCallsBody): { phone?: string; name?: string } {
  const customer = body.message?.call?.customer;
  if (!customer) return {};

  const phoneCandidate = customer.number ?? customer.phoneNumber;
  const phone =
    typeof phoneCandidate === "string" && isUsablePhone(phoneCandidate)
      ? validateCallerPhone(phoneCandidate).display
      : undefined;

  const name = typeof customer.name === "string" ? customer.name.trim() : undefined;
  return { phone, name: name || undefined };
}

const SERVER_TOOLS = new Set([
  "bookSlot",
  "cancelBooking",
  "rescheduleBooking",
  "findBookings",
  "logContact",
]);

function enrichToolArgs(
  toolName: string,
  args: Record<string, string>,
  caller: { phone?: string; name?: string },
): Record<string, string> {
  if (!SERVER_TOOLS.has(toolName)) return args;

  const enriched = { ...args };

  if (toolName === "findBookings") {
    if (caller.phone && !isUsablePhone(enriched.phone ?? "")) {
      enriched.phone = caller.phone;
    }
    return enriched;
  }

  if (toolName === "logContact") {
    if (caller.phone && !isUsablePhone(enriched.phone ?? "")) {
      enriched.phone = caller.phone;
    }
    const name = enriched.name?.trim() ?? "";
    if (caller.name && (!name || name.toLowerCase() === "caller")) {
      enriched.name = caller.name;
    }
    return enriched;
  }

  const phoneKey = "callerPhone";
  if (caller.phone && !isUsablePhone(enriched[phoneKey] ?? "")) {
    enriched[phoneKey] = caller.phone;
  }

  if (toolName === "bookSlot" || toolName === "rescheduleBooking") {
    const nameKey = "callerName";
    const existing = enriched[nameKey]?.trim() ?? "";
    if (caller.name && (!existing || existing.toLowerCase() === "caller")) {
      enriched[nameKey] = caller.name;
    }
  }

  return enriched;
}

export async function handleVapiToolCalls(body: VapiToolCallsBody) {
  const toolCalls = extractToolCalls(body);
  const callId = body.message?.call?.id;
  const callerContext = extractVapiCallerContext(body);
  const results = [];

  for (const call of toolCalls) {
    try {
      const args = enrichToolArgs(call.name, normalizeArgs(call.parameters), callerContext);
      const output = await runTool(call.name, args);
      const result = toSingleLine(compactToolResult(call.name, output));
      results.push({
        toolCallId: call.id,
        result,
      });

      if (call.name === "logContact" && callId && logContactSucceeded(result)) {
        scheduleEndCall(callId);
      }
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
