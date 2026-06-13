import {
  bookSlot as bookCalendarSlot,
  bookingEventExists,
  cancelBooking as cancelCalendarBooking,
  findBookings as findCalendarBookings,
  type BookingEventSnapshot,
  restoreBookingEvent,
  rescheduleBooking as rescheduleCalendarBooking,
} from "./calendar.js";
import {
  formatPhoneForEntry,
  validateCallerName,
} from "./caller-identity.js";
import { findContactByName, logContact } from "./sheets.js";
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
  sessionTime?: string;
  allowBookingTopic?: boolean;
}): Promise<{ success: boolean; message: string }> {
  try {
    return await logContact(
      {
        name: params.name,
        phone: params.phone,
        date: todayStudioDate(),
        topic: params.topic,
        outcome: params.outcome,
        notes: params.notes,
        sessionDate: params.sessionDate,
        sessionTime: params.sessionTime,
      },
      { allowBookingTopic: params.allowBookingTopic },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sheet update failed";
    console.error("[booking-flow] contact log failed:", message);
    return { success: false, message };
  }
}

/** Name only — never requires phone (cancel / reschedule / lookup). */
async function resolveCallerByNameOnly(callerName: string): Promise<
  | { success: true; callerName: string; callerPhone: string }
  | { success: false; message: string }
> {
  const nameResult = validateCallerName(callerName);
  if (!nameResult.valid) {
    return { success: false, message: nameResult.message ?? "Name required." };
  }

  const existing = await findContactByName(nameResult.normalized!);
  return {
    success: true,
    callerName: nameResult.normalized!,
    callerPhone: existing?.data.phone.trim() ?? "",
  };
}

/** Phone required only for brand-new callers (first booking). */
async function resolveCallerForNewBooking(
  callerName: string,
  callerPhone?: string,
): Promise<
  | { success: true; callerName: string; callerPhone: string }
  | { success: false; message: string }
> {
  const byName = await resolveCallerByNameOnly(callerName);
  if (!byName.success) return byName;

  if (byName.callerPhone) return byName;

  const phone = formatPhoneForEntry(callerPhone ?? "");
  if (!phone) {
    return {
      success: false,
      message: "May I have a phone number where we can reach you? We only need this once.",
    };
  }

  return { success: true, callerName: byName.callerName, callerPhone: phone };
}

export async function lookupBookings(callerName: string) {
  const identity = await resolveCallerByNameOnly(callerName);
  if (!identity.success) {
    return { bookings: [], count: 0, summary: identity.message };
  }

  return findCalendarBookings(
    identity.callerName,
    identity.callerPhone || undefined,
  );
}

/** Book session: calendar event + Contacts sheet row (rolls back calendar if sheet fails). */
export async function bookSession(
  dateTime: string,
  callerName: string,
  callerPhone?: string,
): Promise<{ success: boolean; message: string; dateTime?: string }> {
  const identity = await resolveCallerForNewBooking(callerName, callerPhone);
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
  const onCalendar = await bookingEventExists(
    identity.callerName,
    bookedDateTime,
    identity.callerPhone,
  );
  if (!onCalendar) {
    return { success: false, message: "Calendar booking could not be confirmed. Please try again." };
  }

  const sheetResult = await syncContactLog({
    name: identity.callerName,
    phone: identity.callerPhone,
    topic: "Session booking",
    outcome: "Booked",
    notes: calendarResult.message,
    sessionDate: sessionDateFromDateTime(bookedDateTime),
    sessionTime: calendarResult.displayTime ?? bookedDateTime,
    allowBookingTopic: true,
  });

  if (sheetResult.success) return calendarResult;

  const rolledBack = await cancelCalendarBooking(
    identity.callerName,
    bookedDateTime,
    identity.callerPhone,
  );
  return {
    success: false,
    message: rolledBack.success
      ? "Booking failed — could not update the contact log. Please try again."
      : "Booking failed — contact log error and calendar rollback failed. Staff must verify the calendar.",
  };
}

export async function cancelSession(
  callerName: string,
  dateTime: string,
  _callerPhone?: string,
): Promise<{ success: boolean; message: string; displayTime?: string }> {
  const identity = await resolveCallerByNameOnly(callerName);
  if (!identity.success) {
    return { success: false, message: identity.message };
  }

  const calendarResult = await cancelCalendarBooking(
    identity.callerName,
    dateTime,
    identity.callerPhone || undefined,
  );
  if (!calendarResult.success) return calendarResult;

  const sheetResult = await syncContactLog({
    name: identity.callerName,
    phone: identity.callerPhone,
    topic: "Session cancellation",
    outcome: "Cancelled",
    notes: calendarResult.message,
    sessionDate: "",
    sessionTime: "",
    allowBookingTopic: true,
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

export async function rescheduleSession(
  callerName: string,
  fromDateTime: string,
  toDateTime: string,
  _callerPhone?: string,
): Promise<{ success: boolean; message: string; dateTime?: string }> {
  const identity = await resolveCallerByNameOnly(callerName);
  if (!identity.success) {
    return { success: false, message: identity.message };
  }

  const calendarResult = await rescheduleCalendarBooking(
    identity.callerName,
    fromDateTime,
    toDateTime,
    identity.callerPhone || undefined,
  );
  if (!calendarResult.success) return calendarResult;

  const newDateTime = calendarResult.dateTime ?? toDateTime;
  const sheetResult = await syncContactLog({
    name: identity.callerName,
    phone: identity.callerPhone,
    topic: "Session reschedule",
    outcome: "Rescheduled",
    notes: `Moved to ${newDateTime}. ${calendarResult.message}`,
    sessionDate: sessionDateFromDateTime(newDateTime),
    sessionTime: calendarResult.displayTime ?? newDateTime,
    allowBookingTopic: true,
  });

  if (sheetResult.success) return calendarResult;

  const rolledBack = await rescheduleCalendarBooking(
    identity.callerName,
    toDateTime,
    fromDateTime,
    identity.callerPhone || undefined,
  );
  return {
    success: false,
    message: rolledBack.success
      ? "Reschedule failed — could not update the contact log. Your original time is still booked."
      : "Reschedule failed — contact log error and calendar rollback failed. Staff must verify.",
  };
}

export type { BookingEventSnapshot };
