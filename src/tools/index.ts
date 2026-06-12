import {
  checkAvailability,
  bookClass,
  rescheduleClass,
} from "./calendar.js";
import { findContact, logContact } from "./sheets.js";

export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "checkAvailability",
      description: "Check if a pilates class has open spots on a given day and time. Returns capacity info and alternative times if full.",
      parameters: {
        type: "object",
        properties: {
          className: { type: "string", description: "Class type, e.g. Reformer, Mat Pilates" },
          dayOfWeek: { type: "string", description: "Day name, e.g. Thursday" },
          time: { type: "string", description: "Class time, e.g. 6pm or 18:00" },
        },
        required: ["className", "dayOfWeek", "time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bookClass",
      description: "Book a caller into a class. Requires caller name and phone.",
      parameters: {
        type: "object",
        properties: {
          className: { type: "string" },
          dateTime: { type: "string", description: "ISO 8601 datetime of the class start" },
          callerName: { type: "string" },
          callerPhone: { type: "string" },
        },
        required: ["className", "dateTime", "callerName", "callerPhone"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "rescheduleClass",
      description: "Move an existing booking to a different class time.",
      parameters: {
        type: "object",
        properties: {
          callerIdentifier: { type: "string", description: "Caller name or phone number" },
          fromDateTime: { type: "string", description: "ISO datetime of current booking" },
          toClassName: { type: "string" },
          toDateTime: { type: "string", description: "ISO datetime of new class" },
        },
        required: ["callerIdentifier", "fromDateTime", "toClassName", "toDateTime"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "findContact",
      description: "Look up an existing contact by phone number.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
        },
        required: ["phone"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "logContact",
      description: "Log or update a caller in the Contacts sheet. Call at the end of every conversation.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: "string" },
          date: { type: "string", description: "Date of call, e.g. 2026-06-12" },
          topic: { type: "string", description: "Reason for call, e.g. booking, pricing, reschedule" },
          outcome: { type: "string", description: "Result, e.g. booked, escalated, info provided" },
          notes: { type: "string", description: "Any extra details" },
        },
        required: ["name", "phone", "date", "topic", "outcome", "notes"],
      },
    },
  },
];

export async function runTool(name: string, args: Record<string, string>): Promise<string> {
  switch (name) {
    case "checkAvailability": {
      const result = await checkAvailability(args.className, args.dayOfWeek, args.time);
      return JSON.stringify(result);
    }
    case "bookClass": {
      const result = await bookClass(args.className, args.dateTime, args.callerName, args.callerPhone);
      return JSON.stringify(result);
    }
    case "rescheduleClass": {
      const result = await rescheduleClass(
        args.callerIdentifier,
        args.fromDateTime,
        args.toClassName,
        args.toDateTime,
      );
      return JSON.stringify(result);
    }
    case "findContact": {
      const result = await findContact(args.phone);
      return JSON.stringify(result ?? { found: false });
    }
    case "logContact": {
      const result = await logContact({
        name: args.name,
        phone: args.phone,
        date: args.date,
        topic: args.topic,
        outcome: args.outcome,
        notes: args.notes,
      });
      return JSON.stringify(result);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
