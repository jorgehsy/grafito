export const FILLS = ["#F7D9B8", "#C3DAF2", "#C9E9CF", "#E4CDF0", "#F4E6A8", "#F3C7C7"];
// Prompt-visible: the user names zones by these colors.
export const FILL_NAMES = ["orange", "blue", "green", "purple", "yellow", "red"];
export const OUTLINES = ["#C9622A", "#3E5E8C", "#3E8C4F", "#8A4FA8", "#C48A1C", "#C03A3A"];
export const INK = "#2A2A2E";
export const RED = "#e03131";
export const BLUE = "#3E5E8C";
export const PAPER = "#F5F3EE";
export const TONES: Record<string, { ink: string; fill: string }> = {
  neutral: { ink: INK, fill: "#F4E6A8" },
  warn: { ink: "#d9730d", fill: "#ffd43b" },
  danger: { ink: RED, fill: "#ffa8a8" },
  ok: { ink: "#2f9e44", fill: "#b2f2bb" },
};
export const FONT_FAMILY = "'Patrick Hand', 'Kalam', cursive";
