import {
  bookSlot as bookCalendarSlot,
  cancelBooking as cancelCalendarBooking,
  type BookingEventSnapshot,
  restoreBookingEvent,
  rescheduleBooking as rescheduleCalendarBooking,
} from "./calendar.js";
import { validateBookingIdentity, validateCallerName, validateCallerPhone } from "./caller-identity.js";
import { findContact, logContact } from "./sheets.js";
import { studioDateParts } from "../studio-time.js";

function todayStudioDate(): string {
  const now = studioDateParts();
  return `${now.year}-${now.month}-${now.day}`;
}

function sessionDateFromDateTime(dateTime: string): string {
  return dateTime.slice(0, 10);
}

async function syncContactLog(params: {
  name: string;
  phone: string;
  topic: string;
  outcome: string;
  notes: string;
  sessionDate?: string;
}): Promise<{ success: boolean; message: string }> {
  try {
    return await logContact({
      name: params.name,
      phone: params.phone,
      date: params.sessionDate ?? todayStudioDate(),
      topic: params.topic,
      outcome: params.outcome,
      notes: params.notes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sheet update failed";
    console.error("[booking-flow] contact log failed:", message);
    return { success: false, message };
  }
}

async function resolveCallerName(phone: string, fallback?: string): Promise<string> {
  const existing = await findContact(phone);
  if (existing?.data.name.trim()) {
    const validated = validateCallerName(existing.data.name);
    if (validated.valid) return validated.normalized!;
  }
  if (fallback?.trim()) {
    const validated = validateCallerName(fallback);
    if (validated.valid) return validated.normalized!;
  }
  return "Unknown caller";
}

/** Book session: calendar event + Contacts sheet row (rolls back calendar if sheet fails). */
export async function bookSession(
  dateTime: string,
  callerName: string,
  callerPhone: string,
): Promise<{ success: boolean; message: string; dateTime?: string }> {
  const identity = validateBookingIdentity(callerName, callerPhone);
  if (!identity.success) {
    return { success: false, message: identity.message };
  }

  const calendarResult = await bookCalendarSlot(
    dateTime,
    identity.callerName,
    identity.callerPhone,
  );
  if (!calendarResult.success) return calendarResult;

  const bookedDateTime = calendarResult.dateTime ?? dateTime;
  const sheetResult = await syncContactLog({
    name: identity.callerName,
    phone: identity.callerPhone,
    sessionDate: sessionDateFromDateTime(bookedDateTime),
    topic: "Session booking",
    outcome: "Booked",
    notes: calendarResult.message,
  });

  if (sheetResult.success) return calendarResult;

  const rolledBack = await cancelCalendarBooking(identity.callerPhone, bookedDateTime);
  return {
    success: false,
    message: rolledBack.success
      ? "Booking failed — could not update the contact log. Please try again."
      : "Booking failed — contact log error and calendar rollback failed. Staff must verify the calendar.",
  };
}

/** Cancel session: calendar delete + Contacts sheet update (restores event if sheet fails). */
export async function cancelSession(
  callerPhone: string,
  dateTime: string,
): Promise<{ success: boolean; message: string; displayTime?: string }> {
  const phoneResult = validateCallerPhone(callerPhone);
  if (!phoneResult.valid) {
    return { success: false, message: phoneResult.message ?? "Phone number required." };
  }

  const calendarResult = await cancelCalendarBooking(phoneResult.display!, dateTime);
  if (!calendarResult.success) return calendarResult;

  const callerName = await resolveCallerName(phoneResult.display!, calendarResult.callerName);
  const sheetResult = await syncContactLog({
    name: callerName,
    phone: phoneResult.display!,
    sessionDate: sessionDateFromDateTime(dateTime),
    topic: "Session cancellation",
    outcome: "Cancelled",
    notes: calendarResult.message,
  });

  if (sheetResult.success) return calendarResult;

  if (calendarResult.snapshot) {
    try {
      await restoreBookingEvent(calendarResult.snapshot);
      return {
        success: false,
        message: "Cancellation failed — could not update the contact log. Your session is still booked.",
        displayTime: calendarResult.displayTime,
      };
    } catch {
      return {
        success: false,
        message: "Cancellation failed — contact log error and calendar restore failed. Staff must verify.",
        displayTime: calendarResult.displayTime,
      };
    }
  }

  return {
    success: false,
    message: "Cancellation failed — could not update the contact log.",
    displayTime: calendarResult.displayTime,
  };
}

/** Reschedule session: calendar move + Contacts sheet update (rolls back move if sheet fails). */
export async function rescheduleSession(
  callerPhone: string,
  fromDateTime: string,
  toDateTime: string,
  callerName: string,
): Promise<{ success: boolean; message: string }> {
  const identity = validateBookingIdentity(callerName, callerPhone);
  if (!identity.success) {
    return { success: false, message: identity.message };
  }

  const calendarResult = await rescheduleCalendarBooking(
    identity.callerPhone,
    fromDateTime,
    toDateTime,
    identity.callerName,
  );
  if (!calendarResult.success) return calendarResult;

  const sheetResult = await syncContactLog({
    name: identity.callerName,
    phone: identity.callerPhone,
    sessionDate: sessionDateFromDateTime(toDateTime),
    topic: "Session reschedule",
    outcome: "Rescheduled",
    notes: `Moved from ${fromDateTime} to ${toDateTime}. ${calendarResult.message}`,
  });

  if (sheetResult.success) return calendarResult;

  const rolledBack = await rescheduleCalendarBooking(
    identity.callerPhone,
    toDateTime,
    fromDateTime,
    identity.callerName,
  );
  return {
    success: false,
    message: rolledBack.success
      ? "Reschedule failed — could not update the contact log. Your original time is still booked."
      : "Reschedule failed — contact log error and calendar rollback failed. Staff must verify.",
  };
}

export type { BookingEventSnapshot };
