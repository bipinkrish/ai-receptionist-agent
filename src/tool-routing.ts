import type { ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import {
  calendarToolDefinitions,
  contactToolDefinitions,
  loggingToolDefinitions,
} from "./tools/index.js";
import { transcriptHasCallerName, transcriptHasPhone } from "./tools/caller-identity.js";

const PHONE_REGEX = /\b\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}\b|\b\d{7,}\b|\b555[-\s]?[A-Z0-9-]+\b/i;
const DAY_REGEX = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const TIME_REGEX = /\b(\d{1,2}(:\d{2})?\s*(am|pm))\b/i;
const SCHEDULING_REGEX =
  /\b(book(ing)?|availab|session|schedule|reschedul|slot|cancel|move my|change my|when is|what time|openings?|my booking|existing booking)\b/i;
const CONFIRM_REGEX = /^(yes|yeah|yep|confirm|correct|that's right|sounds good|please do|go ahead)\b/i;
const WRAPUP_REGEX = /^(exit|bye|goodbye|that's all|done|thank you|thanks)\b/i;
const HOURS_REGEX = /\b(hours?|open|close|when are you open|what time do you (open|close))\b/i;
const RESCHEDULE_REGEX = /\b(reschedul|move my|change my|switch my|different time)\b/i;
const CANCEL_REGEX = /\b(cancel|cancellation|call off|don't want|remove my booking)\b/i;
const PRICING_REGEX = /\b(price|pricing|cost|how much|pack|drop-?in|unlimited)\b/i;

type HistoryMessage = { role: string; content?: unknown };

interface ConversationIntent {
  hasPhone: boolean;
  hasName: boolean;
  hasDay: boolean;
  hasTime: boolean;
  wantsScheduling: boolean;
  wantsHours: boolean;
  wantsReschedule: boolean;
  wantsCancel: boolean;
  wantsPricing: boolean;
  isWrapUp: boolean;
  pendingConfirm: boolean;
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  return "";
}

function toolName(tool: ChatCompletionTool): string | undefined {
  return "function" in tool ? tool.function.name : undefined;
}

function hasTool(tools: ChatCompletionTool[] | undefined, name: string): boolean {
  return tools?.some((t) => toolName(t) === name) ?? false;
}

function pickTools(defs: ChatCompletionTool[], names: string[]): ChatCompletionTool[] {
  return names
    .map((name) => defs.find((t) => toolName(t) === name))
    .filter((t): t is ChatCompletionTool => t !== undefined);
}

function dedupeTools(tools: ChatCompletionTool[]): ChatCompletionTool[] {
  const seen = new Set<string>();
  return tools.filter((t) => {
    const name = toolName(t);
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function buildTranscript(history: HistoryMessage[], userMessage: string): string {
  const parts = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => messageText(m.content));
  parts.push(userMessage);
  return parts.join("\n").toLowerCase();
}

function lastAssistantMessage(history: HistoryMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return messageText(history[i].content).toLowerCase();
    }
  }
  return "";
}

function detectIntent(history: HistoryMessage[], userMessage: string): ConversationIntent {
  const transcript = buildTranscript(history, userMessage);
  const trimmed = userMessage.trim();
  const lastAssistant = lastAssistantMessage(history);

  return {
    hasPhone: PHONE_REGEX.test(transcript) || transcriptHasPhone(transcript),
    hasName: transcriptHasCallerName(transcript, userMessage),
    hasDay: DAY_REGEX.test(userMessage) || DAY_REGEX.test(transcript),
    hasTime: TIME_REGEX.test(userMessage),
    wantsScheduling: SCHEDULING_REGEX.test(transcript) || SCHEDULING_REGEX.test(userMessage),
    wantsHours: HOURS_REGEX.test(userMessage),
    wantsReschedule:
      !CANCEL_REGEX.test(transcript) &&
      (RESCHEDULE_REGEX.test(transcript) || RESCHEDULE_REGEX.test(userMessage)),
    wantsCancel: CANCEL_REGEX.test(transcript) || CANCEL_REGEX.test(userMessage),
    wantsPricing: PRICING_REGEX.test(userMessage),
    isWrapUp: WRAPUP_REGEX.test(trimmed),
    pendingConfirm:
      CONFIRM_REGEX.test(trimmed) &&
      /book|confirm|slot|session|dateTime|available at|cancel/i.test(lastAssistant),
  };
}

function calendarToolsForIntent(intent: ConversationIntent): ChatCompletionTool[] {
  if (intent.wantsCancel) {
    return pickTools(calendarToolDefinitions, ["findBookings", "cancelBooking"]);
  }

  const names: string[] = [];

  const needsCalendar =
    intent.wantsScheduling ||
    intent.wantsReschedule ||
    intent.pendingConfirm ||
    intent.hasDay ||
    intent.wantsHours;

  if (!needsCalendar) return [];

  if (intent.wantsHours && !intent.wantsScheduling && !intent.hasDay && !intent.pendingConfirm) {
    return pickTools(calendarToolDefinitions, ["getBusinessHours"]);
  }

  if (intent.wantsHours) {
    names.push("getBusinessHours");
  }

  if (intent.hasDay || intent.wantsScheduling || intent.pendingConfirm || intent.wantsReschedule) {
    names.push("listAvailableSlots", "checkSlot");
  }

  if (intent.hasName && (intent.pendingConfirm || intent.wantsScheduling) && !intent.wantsCancel && !intent.wantsReschedule) {
    names.push("bookSlot");
  }

  if (intent.wantsReschedule) {
    names.push("findBookings");
    if (intent.hasName) {
      names.push("rescheduleBooking");
    }
  } else if (intent.hasName && intent.wantsScheduling) {
    names.push("findBookings");
  }

  return pickTools(calendarToolDefinitions, names);
}

/** Force a tool call only when we have enough info for the tool to succeed. */
export function shouldRequireTools(userMessage: string, history: HistoryMessage[]): boolean {
  const intent = detectIntent(history, userMessage);
  const trimmed = userMessage.trim();
  const lastAssistant = lastAssistantMessage(history);

  // Clarifications / pushback — let the model respond in text, not force a tool
  if (/^(but |why |how come|what do you mean|you said|you are saying|i don't|that doesn't)/i.test(trimmed)) {
    return false;
  }

  if (intent.pendingConfirm && intent.hasName) return true;
  if (intent.hasDay && intent.hasTime) return true;

  if (PHONE_REGEX.test(trimmed) && /book|slot|session|phone|name|confirm|time|cancel/i.test(lastAssistant)) {
    return true;
  }

  if (intent.wantsHours && !intent.wantsScheduling && !intent.hasDay) return true;

  if ((intent.wantsCancel || intent.wantsReschedule) && intent.hasName) return true;

  return false;
}

/** Return the minimal tool set needed for this turn, or undefined for text-only. */
export function getActiveTools(
  history: HistoryMessage[],
  userMessage: string,
): ChatCompletionTool[] | undefined {
  const intent = detectIntent(history, userMessage);
  const transcript = buildTranscript(history, userMessage);

  // Pricing/hours in policy — no tools unless scheduling context
  if (
    intent.wantsPricing &&
    !intent.wantsScheduling &&
    !intent.hasDay &&
    !intent.hasPhone &&
    !intent.wantsHours
  ) {
    return undefined;
  }

  const tools: ChatCompletionTool[] = [];

  tools.push(...calendarToolsForIntent(intent));

  if (intent.hasName) {
    tools.push(...contactToolDefinitions);
    if (
      intent.wantsScheduling ||
      intent.wantsReschedule ||
      intent.wantsCancel ||
      /\b(my booking|existing booking|already book|upcoming session)\b/i.test(transcript)
    ) {
      tools.push(...pickTools(calendarToolDefinitions, ["findBookings"]));
    }
  }

  if (
    intent.hasName &&
    (intent.isWrapUp || intent.wantsScheduling || intent.wantsReschedule || intent.wantsCancel)
  ) {
    tools.push(...loggingToolDefinitions);
  }

  const deduped = dedupeTools(tools);
  return deduped.length > 0 ? deduped : undefined;
}

const SCHEDULING_POLICY = `\nScheduling: identify callers by first+last name only. Phone only for first-time callers. NEVER ask returning callers to repeat their phone. Never ask for calendar dates — pass day name to listAvailableSlots/checkSlot. Ask what TIME works.`;

const HOURS_POLICY = `\nCall getBusinessHours — answer briefly.`;

const RESCHEDULE_POLICY = `\nReschedule: name only → call findBookings FIRST (never guess bookings) → confirm displayTime with caller → ask for new day/time → rescheduleBooking using exact fromDateTime from findBookings. Never ask phone. Never state any booking details without findBookings results.`;

const CANCEL_POLICY = `\nCancel: name only → call findBookings FIRST (never guess bookings) → confirm displayTime with caller → cancelBooking with exact dateTime. Never ask phone. Never state any booking details without findBookings results.`;

const LOGGING_POLICY = `\nCall logContact silently before goodbye for general call notes only — never topic "Session booking". Book/cancel/reschedule auto-logged. Date YYYY-MM-DD.`;

/** Extra system instructions based on which tools are active this turn. */
export function schedulingPolicyAddon(tools: ChatCompletionTool[] | undefined): string {
  if (!tools?.length) return "";

  const parts: string[] = [];

  if (hasTool(tools, "getBusinessHours") && !hasTool(tools, "listAvailableSlots")) {
    parts.push(HOURS_POLICY);
  }
  if (hasTool(tools, "listAvailableSlots") || hasTool(tools, "bookSlot")) {
    parts.push(SCHEDULING_POLICY);
  }
  if (hasTool(tools, "rescheduleBooking")) {
    parts.push(RESCHEDULE_POLICY);
  }
  if (hasTool(tools, "cancelBooking")) {
    parts.push(CANCEL_POLICY);
  }
  if (hasTool(tools, "logContact")) {
    parts.push(LOGGING_POLICY);
  }

  return parts.join("");
}

const TOOL_STATUS_MESSAGES: Record<string, string> = {
  bookSlot: "One moment — booking your session now.",
  rescheduleBooking: "One moment — updating your booking now.",
  cancelBooking: "One moment — cancelling your booking now.",
  findBookings: "One moment — looking up your bookings.",
  checkSlot: "One moment — checking that time.",
  listAvailableSlots: "One moment — checking what's open.",
};

export function getWorkingStatusMessage(
  userMessage: string,
  history: HistoryMessage[],
): string | undefined {
  const intent = detectIntent(history, userMessage);
  const lastAssistant = lastAssistantMessage(history);
  const trimmed = userMessage.trim();

  if (CONFIRM_REGEX.test(trimmed) || intent.pendingConfirm) {
    if (intent.wantsCancel || /cancel/i.test(lastAssistant)) {
      return TOOL_STATUS_MESSAGES.cancelBooking;
    }
    if (intent.wantsReschedule || RESCHEDULE_REGEX.test(buildTranscript(history, userMessage))) {
      return TOOL_STATUS_MESSAGES.rescheduleBooking;
    }
    return TOOL_STATUS_MESSAGES.bookSlot;
  }

  if ((intent.wantsCancel || intent.wantsReschedule) && intent.hasName) {
    return TOOL_STATUS_MESSAGES.findBookings;
  }

  return undefined;
}

export function getToolStatusMessage(toolName: string): string | undefined {
  return TOOL_STATUS_MESSAGES[toolName];
}
