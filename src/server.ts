import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import type { ChatCompletionMessageParam } from "groq-sdk/resources/chat/completions";
import { chat, createHistory, getOpeningGreeting } from "./agent.js";

dotenv.config();

const CORS_ORIGIN = process.env.CORS_ORIGIN;
const PORT = parseInt(process.env.PORT ?? "3000", 10);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC = join(ROOT, "public");

const sessions = new Map<string, ChatCompletionMessageParam[]>();

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".ico": "image/x-icon",
};

function corsHeaders(req: IncomingMessage): Record<string, string> {
  if (!CORS_ORIGIN) return {};
  const origin = req.headers.origin;
  if (origin !== CORS_ORIGIN) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function serveStatic(
  req: IncomingMessage,
  pathname: string,
  res: ServerResponse,
): Promise<boolean> {
  const filePath = join(PUBLIC, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(PUBLIC)) {
    sendJson(req, res, 403, { error: "Forbidden" });
    return true;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (req.method === "POST" && pathname === "/api/session") {
    const id = randomUUID();
    sessions.set(id, createHistory());
    sendJson(req, res, 200, { sessionId: id, greeting: getOpeningGreeting() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    let body: { sessionId?: string; message?: string };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      sendJson(req, res, 400, { error: "Invalid JSON" });
      return;
    }

    const message = body.message?.trim();
    if (!message) {
      sendJson(req, res, 400, { error: "message is required" });
      return;
    }

    let sessionId = body.sessionId;
    if (!sessionId || !sessions.has(sessionId)) {
      sessionId = randomUUID();
      sessions.set(sessionId, createHistory());
    }

    const history = sessions.get(sessionId)!;
    let status: string | undefined;

    try {
      const reply = await chat(message, history, (msg) => {
        status = msg;
      });

      if (message.toLowerCase() === "exit") {
        sessions.delete(sessionId);
      }

      sendJson(req, res, 200, { sessionId, reply, status });
    } catch (err) {
      console.error(err);
      sendJson(req, res, 500, { error: "Agent error" });
    }
    return;
  }

  if (req.method === "GET") {
    const served = await serveStatic(req, pathname, res);
    if (served) return;
  }

  sendJson(req, res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Solstice receptionist UI → http://localhost:${PORT}`);
});
