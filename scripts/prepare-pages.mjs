import { mkdirSync, readFileSync, writeFileSync } from "fs";

const apiBase = (process.env.API_BASE_URL ?? "").replace(/\/$/, "");
const html = readFileSync("public/index.html", "utf-8").replaceAll(
  "__API_BASE_URL__",
  apiBase,
);

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", html);

console.log(`Prepared dist/index.html (API_BASE=${apiBase || "(same origin)"})`);
