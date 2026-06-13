/** Strip bulky fields from tool JSON before sending back to the LLM. */
export function compactToolResult(name: string, raw: string): string {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;

    if (name === "listAvailableSlots") {
      const { slots: _slots, ...rest } = data;
      return JSON.stringify(rest);
    }

    if (name === "findBookings" && Array.isArray(data.bookings)) {
      const bookings = data.bookings.slice(0, 4).map((b) => {
        const row = b as Record<string, unknown>;
        const { sessionDate: _sd, sessionTime: _st, summary: _sum, ...rest } = row;
        return rest;
      });
      const compact: Record<string, unknown> = { ...data, bookings };
      if (data.bookings.length > 4) compact.truncated = true;
      return JSON.stringify(compact);
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
