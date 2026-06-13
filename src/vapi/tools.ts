import { toolDefinitions } from "../tools/index.js";

/** Suppress Vapi's default "One moment" / "Hold on a sec" filler on every tool call. */
const SILENT_TOOL_START = [{ type: "request-start" as const, content: "" }];

export type VapiFunctionTool = {
  type: "function";
  function: (typeof toolDefinitions)[number]["function"];
  server: { url: string };
  messages?: typeof SILENT_TOOL_START;
};

export type VapiEndCallTool = {
  type: "endCall";
};

export type VapiAssistantTool = VapiFunctionTool | VapiEndCallTool;

export function buildVapiTools(serverUrl: string): VapiFunctionTool[] {
  return toolDefinitions.map((tool) => ({
    type: "function" as const,
    function: tool.function,
    server: { url: serverUrl },
    messages: SILENT_TOOL_START,
  }));
}

export function buildAssistantTools(serverUrl: string): VapiAssistantTool[] {
  return [...buildVapiTools(serverUrl), { type: "endCall" as const }];
}
