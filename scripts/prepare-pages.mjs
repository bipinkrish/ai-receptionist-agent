import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { injectAppConfig } from "./inject-config.mjs";

const html = injectAppConfig(readFileSync("public/index.html", "utf-8"), {
  apiBase: process.env.API_BASE_URL ?? "",
  vapiPublicKey: process.env.VAPI_PUBLIC_KEY ?? "",
  vapiAssistantId: process.env.VAPI_ASSISTANT_ID ?? "",
});

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);

console.log(`Prepared dist/index.html (API_BASE=${process.env.API_BASE_URL || "(none)"})`);
