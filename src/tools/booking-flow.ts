import {
  bookSlot as bookCalendarSlot,
  cancelBooking as cancelCalendarBooking,
  type BookingEventSnapshot,
  restoreBookingEvent,
  rescheduleBooking as rescheduleCalendarBooking,
} from "./calendar.js";
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
  if (existing?.data.name.trim()) return existing.data.name.trim();
  if (fallback?.trim()) return fallback.trim();
  return "Caller";
}

/** Book session: calendar event + Contacts sheet row (rolls back calendar if sheet fails). */
export async function bookSession(
  dateTime: string,
  callerName: string,
  callerPhone: string,
): Promise<{ success: boolean; message: string; dateTime?: string }> {
  const calendarResult = await bookCalendarSlot(dateTime, callerName, callerPhone);
  if (!calendarResult.success) return calendarResult;

  const bookedDateTime = calendarResult.dateTime ?? dateTime;
  const sheetResult = await syncContactLog({
    name: callerName,
    phone: callerPhone,
    sessionDate: sessionDateFromDateTime(bookedDateTime),
    topic: "Session booking",
    outcome: "Booked",
    notes: calendarResult.message,
  });

  if (sheetResult.success) return calendarResult;

  const rolledBack = await cancelCalendarBooking(callerPhone, bookedDateTime);
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
  const calendarResult = await cancelCalendarBooking(callerPhone, dateTime);
  if (!calendarResult.success) return calendarResult;

  const callerName = await resolveCallerName(callerPhone, calendarResult.callerName);
  const sheetResult = await syncContactLog({
    name: callerName,
    phone: callerPhone,
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
  const calendarResult = await rescheduleCalendarBooking(
    callerPhone,
    fromDateTime,
    toDateTime,
    callerName,
  );
  if (!calendarResult.success) return calendarResult;

  const sheetResult = await syncContactLog({
    name: callerName,
    phone: callerPhone,
    sessionDate: sessionDateFromDateTime(toDateTime),
    topic: "Session reschedule",
    outcome: "Rescheduled",
    notes: `Moved from ${fromDateTime} to ${toDateTime}. ${calendarResult.message}`,
  });

  if (sheetResult.success) return calendarResult;

  const rolledBack = await rescheduleCalendarBooking(callerPhone, toDateTime, fromDateTime, callerName);
  return {
    success: false,
    message: rolledBack.success
      ? "Reschedule failed — could not update the contact log. Your original time is still booked."
      : "Reschedule failed — contact log error and calendar rollback failed. Staff must verify.",
  };
}

export type { BookingEventSnapshot };
