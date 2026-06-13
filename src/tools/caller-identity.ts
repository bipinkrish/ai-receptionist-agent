const PLACEHOLDER_NAMES = new Set([
  "caller",
  "guest",
  "unknown",
  "user",
  "client",
  "customer",
  "n/a",
  "na",
  "none",
  "anonymous",
  "test",
  "name",
]);

const EXCLUDED_NAME_WORDS = new Set([
  "yes",
  "yeah",
  "yep",
  "no",
  "nope",
  "ok",
  "okay",
  "thanks",
  "thank",
  "you",
  "bye",
  "goodbye",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "tomorrow",
  "today",
  "morning",
  "afternoon",
  "evening",
  "please",
  "book",
  "booking",
  "session",
]);

const NAME_GIVEN_REGEX =
  /\b(?:my name is|i am|i'm|this is|name'?s?|call me)\s+[a-z][a-z' -]{1,}/i;

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function formatPhoneDisplay(digits: string): string {
  const d = digits.slice(-10);
  if (d.length !== 10) return digits;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function validateCallerPhone(phone: string): {
  valid: boolean;
  normalized?: string;
  display?: string;
  message?: string;
} {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 10) {
    return { valid: false, message: "Ask for their 10-digit phone number before proceeding." };
  }

  const normalized = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.slice(-10);
  if (/^0+$/.test(normalized) || normalized === "1234567890" || normalized === "5555555555") {
    return {
      valid: false,
      message: "Need a real phone number from the caller — do not use placeholders.",
    };
  }

  return {
    valid: true,
    normalized,
    display: formatPhoneDisplay(normalized),
  };
}

export function validateCallerName(name: string): {
  valid: boolean;
  normalized?: string;
  message?: string;
} {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) {
    return { valid: false, message: "Ask for their full name before proceeding." };
  }

  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_NAMES.has(lower)) {
    return {
      valid: false,
      message: "Need the caller's real name — ask for it before booking.",
    };
  }

  if (
    /^(session|booking|pilates|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      trimmed,
    )
  ) {
    return { valid: false, message: "That does not look like a name — ask for their full name." };
  }

  return { valid: true, normalized: trimmed };
}

export function validateBookingIdentity(
  name: string,
  phone: string,
): { success: true; callerName: string; callerPhone: string } | { success: false; message: string } {
  const nameResult = validateCallerName(name);
  if (!nameResult.valid) {
    return { success: false, message: nameResult.message ?? "Name required." };
  }

  const phoneResult = validateCallerPhone(phone);
  if (!phoneResult.valid) {
    return { success: false, message: phoneResult.message ?? "Phone required." };
  }

  return {
    success: true,
    callerName: nameResult.normalized!,
    callerPhone: phoneResult.display!,
  };
}

/** Heuristic: has the caller given their name anywhere in the conversation? */
export function transcriptHasCallerName(transcript: string, userMessage: string): boolean {
  if (NAME_GIVEN_REGEX.test(transcript)) return true;

  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (/\d/.test(trimmed)) return false;
  if (/^(yes|yeah|yep|no|nope|ok|okay|thanks|thank you|bye|goodbye)\b/i.test(trimmed)) {
    return false;
  }
  if (/\b(am|pm)\b/i.test(trimmed)) return false;

  // Short name-only reply (e.g. assistant asked "What's your name?" → "Sarah Chen")
  if (/^[a-z][a-z' -]{1,38}$/i.test(trimmed) && trimmed.split(/\s+/).length <= 4) {
    const words = trimmed.toLowerCase().split(/\s+/);
    if (!words.some((word) => EXCLUDED_NAME_WORDS.has(word))) {
      return true;
    }
  }

  return false;
}

export function isUsablePhone(value: string | undefined): boolean {
  if (!value) return false;
  return validateCallerPhone(value).valid;
}
