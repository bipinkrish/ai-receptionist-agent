/** Strip bulky fields from tool JSON before sending back to the LLM. */
export function compactToolResult(name: string, raw: string): string {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;

    if (name === "listAvailableSlots") {
      const { slots: _slots, ...rest } = data;
      return JSON.stringify(rest);
    }

    if (name === "findBookings" && Array.isArray(data.bookings) && data.bookings.length > 4) {
      return JSON.stringify({ ...data, bookings: data.bookings.slice(0, 4), truncated: true });
    }

    if (name === "checkSlot" && Array.isArray(data.nearbySlots)) {
      const { nearbySlots, ...rest } = data;
      return JSON.stringify({ ...rest, nearbyCount: nearbySlots.length });
    }

    return raw;
  } catch {
    return raw;
  }
}
