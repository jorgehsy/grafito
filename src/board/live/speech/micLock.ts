// Candado del micrófono entre pestañas: Chrome sólo deja un reconocedor vivo por origen.
// Cuando una pestaña reclama el mic, las demás lo sueltan (en vez de pelear reiniciándolo).
export const MIC_CHANNEL = "grafito.mic";
export const MIC_TAKEN_MESSAGE = "El micrófono se activó en otra pestaña. Pulsa Hablar aquí para recuperarlo.";

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
