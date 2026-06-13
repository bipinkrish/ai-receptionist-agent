import { bookSession, cancelSession, rescheduleSession } from "./booking-flow.js";
import {
  checkSlot,
  findBookings,
  getStudioBusinessHours,
  listAvailableSlots,
} from "./calendar.js";
import { findContactByName, logContact } from "./sheets.js";

const getBusinessHoursTool = {
  type: "function" as const,
  function: {
    name: "getBusinessHours",
    description: "Returns studio business hours and timezone. Use for hours questions — do not guess.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const listAvailableSlotsTool = {
  type: "function" as const,
  function: {
    name: "listAvailableSlots",
    description:
      "List open 30-minute slots for a weekday. Pass the day name only (e.g. Saturday) — resolves to the next upcoming that day automatically. Never ask the caller for a calendar date.",
    parameters: {
      type: "object",
      properties: {
        dayOfWeek: {
          type: "string",
          description: "Weekday name only: Monday, Saturday, next Saturday, etc.",
        },
      },
      required: ["dayOfWeek"],
    },
  },
};

const checkSlotTool = {
  type: "function" as const,
  function: {
    name: "checkSlot",
    description:
      "Check if a time slot is available. Pass weekday name (e.g. Saturday) — date is resolved automatically. Never ask the caller for a calendar date.",
    parameters: {
      type: "object",
      properties: {
        dayOfWeek: { type: "string", description: "Weekday name: Saturday, next Saturday, etc." },
        time: { type: "string", description: "e.g. 6pm, 6:30pm, 18:00" },
      },
      required: ["dayOfWeek", "time"],
    },
  },
};

const bookSlotTool = {
  type: "function" as const,
  function: {
    name: "bookSlot",
    description:
      "Book a 30-minute session. Requires caller's first and last name (not phone digits) and phone number (any format). Updates calendar and contact log together.",
    parameters: {
      type: "object",
      properties: {
        dateTime: { type: "string", description: "Exact dateTime from a tool response" },
        callerName: { type: "string", description: "Caller's first and last name — used to identify them" },
        callerPhone: {
          type: "string",
          description: "Phone number — only required for first-time callers; omit for returning callers",
        },
      },
      required: ["dateTime", "callerName"],
    },
  },
};

const findBookingsTool = {
  type: "function" as const,
  function: {
    name: "findBookings",
    description: "Find upcoming session bookings by caller's full name. Returning callers are identified by name only.",
    parameters: {
      type: "object",
      properties: {
        callerName: { type: "string", description: "Caller's first and last name" },
        phone: { type: "string", description: "Optional — only if already known from sheet" },
      },
      required: ["callerName"],
    },
  },
};

const rescheduleBookingTool = {
  type: "function" as const,
  function: {
    name: "rescheduleBooking",
    description:
      "Move an existing booking to a new slot. Updates calendar and contact log together. Verify the new slot with checkSlot first.",
    parameters: {
      type: "object",
      properties: {
        callerPhone: {
          type: "string",
          description: "Optional — only for first-time callers; returning callers identified by name",
        },
        callerName: { type: "string", description: "Caller's first and last name" },
        fromDateTime: { type: "string", description: "Current booking dateTime from findBookings" },
        toDateTime: { type: "string", description: "New slot dateTime from listAvailableSlots or checkSlot" },
      },
      required: ["callerName", "fromDateTime", "toDateTime"],
    },
  },
};

const cancelBookingTool = {
  type: "function" as const,
  function: {
    name: "cancelBooking",
    description:
      "Cancel an existing booking. Updates calendar and contact log together. Use dateTime from findBookings. Call before saying it is cancelled.",
    parameters: {
      type: "object",
      properties: {
        callerName: { type: "string", description: "Caller's first and last name" },
        callerPhone: {
          type: "string",
          description: "Optional — only for first-time callers",
        },
        dateTime: { type: "string", description: "Exact dateTime from findBookings" },
      },
      required: ["callerName", "dateTime"],
    },
  },
};

const findContactTool = {
  type: "function" as const,
  function: {
    name: "findContact",
    description: "Look up a returning caller by full name to see if they are in the system.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "First and last name" } },
      required: ["name"],
    },
  },
};

const logContactTool = {
  type: "function" as const,
  function: {
    name: "logContact",
    description:
      "Log caller for escalation callback or wrap-up notes. For escalation use topic: escalation, outcome: callback requested. Not for booking status (auto-logged).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        date: { type: "string", description: "Call date as YYYY-MM-DD (use today's date)" },
        topic: { type: "string" },
        outcome: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name", "phone", "date", "topic", "outcome", "notes"],
    },
  },
};

export const calendarToolDefinitions = [
  getBusinessHoursTool,
  listAvailableSlotsTool,
  checkSlotTool,
  bookSlotTool,
  findBookingsTool,
  rescheduleBookingTool,
  cancelBookingTool,
];
export const contactToolDefinitions = [findContactTool];
export const loggingToolDefinitions = [logContactTool];

export const toolDefinitions = [
  ...calendarToolDefinitions,
  ...contactToolDefinitions,
  ...loggingToolDefinitions,
];

export async function runTool(name: string, args: Record<string, string>): Promise<string> {
  switch (name) {
    case "getBusinessHours":
      return JSON.stringify(await getStudioBusinessHours());
    case "listAvailableSlots":
      return JSON.stringify(await listAvailableSlots(args.dayOfWeek));
    case "checkSlot":
      return JSON.stringify(await checkSlot(args.dayOfWeek, args.time));
    case "bookSlot":
      return JSON.stringify(
        await bookSession(args.dateTime, args.callerName, args.callerPhone),
      );
    case "findBookings":
      return JSON.stringify(await findBookings(args.callerName, args.phone));
    case "rescheduleBooking":
      return JSON.stringify(
        await rescheduleSession(
          args.callerName,
          args.fromDateTime,
          args.toDateTime,
          args.callerPhone,
        ),
      );
    case "cancelBooking":
      return JSON.stringify(await cancelSession(args.callerName, args.dateTime, args.callerPhone));
    case "findContact":
      return JSON.stringify((await findContactByName(args.name)) ?? { found: false });
    case "logContact":
      return JSON.stringify(
        await logContact({
          name: args.name,
          phone: args.phone,
          date: args.date,
          topic: args.topic,
          outcome: args.outcome,
          notes: args.notes,
        }),
      );
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
