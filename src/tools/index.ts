import { bookSession, cancelSession, rescheduleSession } from "./booking-flow.js";
import {
  checkSlot,
  findBookings,
  getStudioBusinessHours,
  listAvailableSlots,
} from "./calendar.js";
import { findContact, logContact } from "./sheets.js";

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
      "List open 30-minute slots for a day. Returns a summary and slot list — ask the caller what time they want; do not read every slot aloud.",
    parameters: {
      type: "object",
      properties: {
        dayOfWeek: { type: "string", description: "e.g. Monday, Thursday" },
      },
      required: ["dayOfWeek"],
    },
  },
};

const checkSlotTool = {
  type: "function" as const,
  function: {
    name: "checkSlot",
    description: "Check if a specific 30-minute session slot is available on a given day and time.",
    parameters: {
      type: "object",
      properties: {
        dayOfWeek: { type: "string" },
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
      "Book a 30-minute session. REQUIRES the caller's real full name and 10-digit phone collected in this conversation first — never placeholders. Updates calendar and contact log together.",
    parameters: {
      type: "object",
      properties: {
        dateTime: { type: "string", description: "Exact dateTime from a tool response" },
        callerName: { type: "string", description: "Caller's full name as they stated it" },
        callerPhone: { type: "string", description: "Caller's 10-digit phone number as they stated it" },
      },
      required: ["dateTime", "callerName", "callerPhone"],
    },
  },
};

const findBookingsTool = {
  type: "function" as const,
  function: {
    name: "findBookings",
    description: "Find upcoming session bookings for a phone number.",
    parameters: {
      type: "object",
      properties: {
        phone: { type: "string" },
      },
      required: ["phone"],
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
        callerPhone: { type: "string" },
        callerName: { type: "string" },
        fromDateTime: { type: "string", description: "Current booking dateTime from findBookings" },
        toDateTime: { type: "string", description: "New slot dateTime from listAvailableSlots or checkSlot" },
      },
      required: ["callerPhone", "callerName", "fromDateTime", "toDateTime"],
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
        callerPhone: { type: "string" },
        dateTime: { type: "string", description: "Exact dateTime from findBookings" },
      },
      required: ["callerPhone", "dateTime"],
    },
  },
};

const findContactTool = {
  type: "function" as const,
  function: {
    name: "findContact",
    description: "Look up an existing contact by phone number.",
    parameters: {
      type: "object",
      properties: { phone: { type: "string" } },
      required: ["phone"],
    },
  },
};

const logContactTool = {
  type: "function" as const,
  function: {
    name: "logContact",
    description:
      "Log or update a caller in the Contacts sheet for call wrap-up. Book/cancel/reschedule are logged automatically — use this for general call notes before goodbye.",
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
      return JSON.stringify(await bookSession(args.dateTime, args.callerName, args.callerPhone));
    case "findBookings":
      return JSON.stringify(await findBookings(args.phone));
    case "rescheduleBooking":
      return JSON.stringify(
        await rescheduleSession(
          args.callerPhone,
          args.fromDateTime,
          args.toDateTime,
          args.callerName,
        ),
      );
    case "cancelBooking":
      return JSON.stringify(await cancelSession(args.callerPhone, args.dateTime));
    case "findContact":
      return JSON.stringify((await findContact(args.phone)) ?? { found: false });
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
