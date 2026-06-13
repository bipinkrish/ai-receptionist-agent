import { toolDefinitions } from "../tools/index.js";

export type VapiFunctionTool = {
  type: "function";
  function: (typeof toolDefinitions)[number]["function"];
  server: { url: string };
};

export function buildVapiTools(serverUrl: string): VapiFunctionTool[] {
  return toolDefinitions.map((tool) => ({
    type: "function" as const,
    function: tool.function,
    server: { url: serverUrl },
  }));
}
