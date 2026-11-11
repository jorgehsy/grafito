// Space does two jobs: a tap toggles the microphone, holding it while dragging pans the board.
// The engine marks the hold as used when a pan starts with it, so the mic shortcut can tell the two apart.
export const spacePan = { used: false };
