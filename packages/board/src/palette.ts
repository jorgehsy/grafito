import type { GroupKind } from "@grafito/contract";

export const FILLS = ["#F7D9B8", "#C3DAF2", "#C9E9CF", "#E4CDF0", "#F4E6A8", "#F3C7C7"];
// Prompt-visible: the user names zones by these colors.
export const FILL_NAMES = ["orange", "blue", "green", "purple", "yellow", "red"];
export const OUTLINES = ["#C9622A", "#3E5E8C", "#3E8C4F", "#8A4FA8", "#C48A1C", "#C03A3A"];
export const INK = "#2A2A2E";
export const RED = "#e03131";
export const BLUE = "#3E5E8C";
export const PAPER = "#F5F3EE";
/** The pencil look of a proposal (architect mode): grey lines, a lighter grey for its text. */
export const PENCIL = "#8A8A90";
export const PENCIL_TEXT = "#7A7A80";
export const TONES: Record<string, { ink: string; fill: string }> = {
  neutral: { ink: INK, fill: "#F4E6A8" },
  warn: { ink: "#d9730d", fill: "#ffd43b" },
  danger: { ink: RED, fill: "#ffa8a8" },
  ok: { ink: "#2f9e44", fill: "#b2f2bb" },
};
export const FONT_FAMILY = "'Patrick Hand', 'Kalam', cursive";
/** AWS group look (from AWS's architecture icon deck): border colour and line style per kind. */
export const GROUP_STYLES: Record<GroupKind, { color: string; line: "solid" | "dash" | "dot" }> = {
  aws_cloud: { color: "#232F3E", line: "solid" },
  region: { color: "#00A4A6", line: "dot" },
  vpc: { color: "#8C4FFF", line: "solid" },
  availability_zone: { color: "#00A4A6", line: "dash" },
  public_subnet: { color: "#7AA116", line: "solid" },
  private_subnet: { color: "#00A4A6", line: "solid" },
  generic: { color: "#7D8998", line: "dash" },
};
