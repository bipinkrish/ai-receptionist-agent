const VAPI_API = "https://api.vapi.ai";

const pendingEnds = new Map<string, ReturnType<typeof setTimeout>>();

/** Fallback hangup if the assistant forgets to invoke endCall after goodbye. */
export function scheduleEndCall(callId: string, delayMs = 12000) {
  cancelScheduledEndCall(callId);
  const timer = setTimeout(() => {
    pendingEnds.delete(callId);
    void hangupCall(callId);
  }, delayMs);
  pendingEnds.set(callId, timer);
}

export function cancelScheduledEndCall(callId: string) {
  const timer = pendingEnds.get(callId);
  if (!timer) return;
  clearTimeout(timer);
  pendingEnds.delete(callId);
}

export async function hangupCall(callId: string) {
  const key = process.env.VAPI_PRIVATE_KEY;
  if (!key) {
    console.warn("[vapi] VAPI_PRIVATE_KEY not set — cannot hang up call", callId);
    return;
  }

  const res = await fetch(`${VAPI_API}/call/${callId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`[vapi] hangup failed for ${callId} (${res.status}):`, text);
    return;
  }

  console.log("[vapi] call ended:", callId);
}
