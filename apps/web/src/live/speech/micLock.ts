// Chrome allows one recognizer per origin: when a tab claims the mic the others release it instead of fighting over restarts.
export const MIC_CHANNEL = "grafito.mic";

type Msg = { type: "claim"; id: string };
type ChannelLike = { postMessage(m: Msg): void; onmessage: ((ev: any) => void) | null; close(): void };

function openChannel(): ChannelLike | null {
  try { return typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(MIC_CHANNEL) : null; } catch { return null; }
}

export function createMicLock(onTaken: () => void, channel: ChannelLike | null = openChannel()) {
  const id = Math.random().toString(36).slice(2);
  if (channel) channel.onmessage = (ev) => { if (ev.data?.type === "claim" && ev.data.id !== id) onTaken(); };
  return {
    claim() { channel?.postMessage({ type: "claim", id }); },
    close() { if (channel) { channel.onmessage = null; channel.close(); } },
  };
}
