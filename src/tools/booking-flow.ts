import {
  bookSlot as bookCalendarSlot,
  bookingEventExists,
  cancelBooking as cancelCalendarBooking,
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
  allowBookingTopic?: boolean;
}): Promise<{ success: boolean; message: string }> {
  try {
    return await logContact(
      {
        name: params.name,
        phone: params.phone,
        date: params.sessionDate ?? todayStudioDate(),
        topic: params.topic,
        outcome: params.outcome,
        notes: params.notes,
      },
      { allowBookingTopic: params.allowBookingTopic },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sheet update failed";
    console.error("[booking-flow] contact log failed:", message);
    return { success: false, message };
  }
}

/** Name verifies returning callers; phone is collected on first call only. */
async function resolveCallerIdentity(
  callerName: string,
  callerPhone?: string,
): Promise<
  | { success: true; callerName: string; callerPhone: string; isNewCaller: boolean }
  | { success: false; message: string }
> {
  const nameResult = validateCallerName(callerName);
  if (!nameResult.valid) {
    return { success: false, message: nameResult.message ?? "Name required." };
  }

  const normalizedName = nameResult.normalized!;
  const existing = await findContactByName(normalizedName);

  if (existing) {
    const storedPhone = existing.data.phone.trim();
    if (storedPhone) {
      return {
        success: true,
        callerName: normalizedName,
        callerPhone: storedPhone,
        isNewCaller: false,
      };
    }
  }

  const phone = formatPhoneForEntry(callerPhone ?? "");
  if (!phone) {
    return {
      success: false,
      message:
        "May I have a phone number where we can reach you? We only need this the first time you book.",
    };
  }

  return {
    success: true,
    callerName: normalizedName,
    callerPhone: phone,
    isNewCaller: !existing,
  };
}

/** Book session: calendar event + Contacts sheet row (rolls back calendar if sheet fails). */
export async function bookSession(
  dateTime: string,
  callerName: string,
  callerPhone?: string,
): Promise<{ success: boolean; message: string; dateTime?: string }> {
  const identity = await resolveCallerIdentity(callerName, callerPhone);
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
    sessionDate: sessionDateFromDateTime(bookedDateTime),
    topic: "Session booking",
    outcome: "Booked",
    notes: calendarResult.message,
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

/** Cancel session: calendar delete + Contacts sheet update (restores event if sheet fails). */
export async function cancelSession(
  callerName: string,
  dateTime: string,
  callerPhone?: string,
): Promise<{ success: boolean; message: string; displayTime?: string }> {
  const identity = await resolveCallerIdentity(callerName, callerPhone);
  if (!identity.success) {
    return { success: false, message: identity.message };
  }

  const calendarResult = await cancelCalendarBooking(
    identity.callerName,
    dateTime,
    identity.callerPhone,
  );
  if (!calendarResult.success) return calendarResult;

  const sheetResult = await syncContactLog({
    name: identity.callerName,
    phone: identity.callerPhone,
    sessionDate: sessionDateFromDateTime(dateTime),
    topic: "Session cancellation",
    outcome: "Cancelled",
    notes: calendarResult.message,
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

/** Reschedule session: calendar move + Contacts sheet update (rolls back move if sheet fails). */
export async function rescheduleSession(
  callerName: string,
  fromDateTime: string,
  toDateTime: string,
  callerPhone?: string,
): Promise<{ success: boolean; message: string }> {
  const identity = await resolveCallerIdentity(callerName, callerPhone);
  if (!identity.success) {
    return { success: false, message: identity.message };
  }

  const calendarResult = await rescheduleCalendarBooking(
    identity.callerName,
    fromDateTime,
    toDateTime,
    identity.callerPhone,
  );
  if (!calendarResult.success) return calendarResult;

  const sheetResult = await syncContactLog({
    name: identity.callerName,
    phone: identity.callerPhone,
    sessionDate: sessionDateFromDateTime(toDateTime),
    topic: "Session reschedule",
    outcome: "Rescheduled",
    notes: `Moved from ${fromDateTime} to ${toDateTime}. ${calendarResult.message}`,
    allowBookingTopic: true,
  });

  if (sheetResult.success) return calendarResult;

  const rolledBack = await rescheduleCalendarBooking(
    identity.callerName,
    toDateTime,
    fromDateTime,
    identity.callerPhone,
  );
  return {
    success: false,
    message: rolledBack.success
      ? "Reschedule failed — could not update the contact log. Your original time is still booked."
      : "Reschedule failed — contact log error and calendar rollback failed. Staff must verify.",
  };
}

export type { BookingEventSnapshot };
