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

const SPOKEN_DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const SPOKEN_DIGIT_WORD_SET = new Set(Object.keys(SPOKEN_DIGIT_WORDS));

const NAME_GIVEN_REGEX =
  /\b(?:my name is|i am|i'm|this is|name'?s?|call me)\s+([a-z][a-z' -]{1,})/i;

/** Parse numeric digits and spoken digit words (voice: "two three three…"). */
export function normalizePhoneDigits(phone: string): string {
  const fromChars = phone.replace(/\D/g, "");

  const spoken: string[] = [];
  const tokens =
    phone.toLowerCase().match(/\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|\d+)\b/g) ??
    [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      spoken.push(...token.split(""));
      continue;
    }
    const digit = SPOKEN_DIGIT_WORDS[token];
    if (digit) spoken.push(digit);
  }

  const fromSpeech = spoken.join("");
  return fromSpeech.length > fromChars.length ? fromSpeech : fromChars;
}

export function formatPhoneDisplay(digits: string): string {
  const d = digits.slice(-10);
  if (d.length === 10) {
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 7) {
    return `${d.slice(0, 3)}-${d.slice(3)}`;
  }
  return digits;
}

/** Lenient phone formatting for sheet/calendar storage — not used to verify returning callers. */
export function formatPhoneForEntry(phone: string): string | undefined {
  const trimmed = phone.trim();
  if (!trimmed) return undefined;

  const digits = normalizePhoneDigits(trimmed);
  if (digits.length >= 7) return formatPhoneDisplay(digits);
  if (trimmed.length >= 7) return trimmed;

  return undefined;
}

export function normalizeCallerNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Fuzzy name match — handles minor STT differences (first + last name). */
export function namesMatch(provided: string, stored: string): boolean {
  const a = normalizeCallerNameKey(provided);
  const b = normalizeCallerNameKey(stored);
  if (!a || !b) return false;
  if (a === b) return true;

  const wordsA = a.split(" ").filter(Boolean);
  const wordsB = b.split(" ").filter(Boolean);
  if (wordsA.length >= 2 && wordsB.length >= 2) {
    return wordsA[0] === wordsB[0] && wordsA[wordsA.length - 1] === wordsB[wordsB.length - 1];
  }

  return a.includes(b) || b.includes(a);
}

function isSpokenDigitName(name: string): boolean {
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const digitWords = words.filter((word) => SPOKEN_DIGIT_WORD_SET.has(word));
  if (digitWords.length === 0) return false;

  if (digitWords.length === words.length) return true;
  if (words.length <= 3 && digitWords.length >= 1) return true;

  return false;
}

export function validateCallerName(name: string): {
  valid: boolean;
  normalized?: string;
  message?: string;
} {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2) {
    return { valid: false, message: "May I have your first and last name?" };
  }

  if (trimmed.split(/\s+/).length < 2) {
    return { valid: false, message: "May I have your first and last name?" };
  }

  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_NAMES.has(lower)) {
    return { valid: false, message: "May I have your first and last name?" };
  }

  if (isSpokenDigitName(trimmed)) {
    return {
      valid: false,
      message: "That sounds like part of a phone number — may I have your first and last name?",
    };
  }

  if (
    /^(session|booking|pilates|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      trimmed,
    )
  ) {
    return { valid: false, message: "May I have your first and last name?" };
  }

  return { valid: true, normalized: trimmed };
}

function nameFromExplicitIntro(transcript: string): boolean {
  const match = transcript.match(NAME_GIVEN_REGEX);
  if (!match?.[1]) return false;
  return validateCallerName(match[1].trim()).valid;
}

/** Heuristic: has the caller given their full name anywhere in the conversation? */
export function transcriptHasCallerName(transcript: string, userMessage: string): boolean {
  if (nameFromExplicitIntro(transcript)) return true;

  const trimmed = userMessage.trim();
  if (!trimmed || trimmed.length > 40) return false;
  if (/\d/.test(trimmed)) return false;
  if (isSpokenDigitName(trimmed)) return false;
  if (/^(yes|yeah|yep|no|nope|ok|okay|thanks|thank you|bye|goodbye)\b/i.test(trimmed)) {
    return false;
  }
  if (/\b(am|pm)\b/i.test(trimmed)) return false;

  if (/^[a-z][a-z' -]{1,38}$/i.test(trimmed) && trimmed.split(/\s+/).length >= 2) {
    const words = trimmed.toLowerCase().split(/\s+/);
    if (words.some((word) => SPOKEN_DIGIT_WORD_SET.has(word))) return false;
    if (!words.some((word) => EXCLUDED_NAME_WORDS.has(word))) {
      return true;
    }
  }

  return false;
}

export function isUsablePhone(value: string | undefined): boolean {
  return formatPhoneForEntry(value ?? "") !== undefined;
}

export function transcriptHasPhone(transcript: string): boolean {
  if (/\b\d{3}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/.test(transcript)) return true;
  return normalizePhoneDigits(transcript).length >= 7;
}
