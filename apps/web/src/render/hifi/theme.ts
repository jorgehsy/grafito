// The look of the hi-fi export: neutral ink, one accent. Light is the print default; dark is the same roles inverted.
import type { GroupKind } from "@grafito/contract";

export interface HifiTheme {
  bg: string;
  /** main text and strong lines */
  ink: string;
  /** secondary text (notes, edge labels) */
  ink2: string;
  /** captions, types, dates */
  muted: string;
  /** hairlines and row rules */
  hair: string;
  /** box outlines */
  border: string;
  /** connectors */
  line: string;
  /** zone frame */
  zoneFill: string;
  zoneBorder: string;
  /** boxes */
  nodeFill: string;
  /** header bands, bars, tinted boxes */
  band: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
  /** an open proposal: outline and text */
  pencil: string;
  tones: Record<string, { ink: string; fill: string }>;
  /** AWS group borders (AWS's own colours; adjusted where they would vanish on the background) */
  groups: Record<GroupKind, string>;
}

const AWS_GROUPS: Record<GroupKind, string> = {
  aws_cloud: "#232F3E", region: "#00A4A6", vpc: "#8C4FFF", availability_zone: "#00A4A6",
  public_subnet: "#7AA116", private_subnet: "#00A4A6", generic: "#7D8998",
};

export const LIGHT: HifiTheme = {
  bg: "#FFFFFF", ink: "#111827", ink2: "#4B5563", muted: "#6B7280", hair: "#E5E7EB", border: "#94A3B8", line: "#475569",
  zoneFill: "#F8FAFC", zoneBorder: "#E2E8F0", nodeFill: "#FFFFFF", band: "#F1F5F9",
  accent: "#1D4ED8", accentSoft: "#EEF3FE", onAccent: "#FFFFFF", pencil: "#9CA3AF",
  tones: {
    neutral: { ink: "#111827", fill: "#F1F5F9" },
    warn: { ink: "#B45309", fill: "#FEF3C7" },
    danger: { ink: "#B91C1C", fill: "#FEE2E2" },
    ok: { ink: "#15803D", fill: "#DCFCE7" },
  },
  groups: AWS_GROUPS,
};

export const DARK: HifiTheme = {
  bg: "#0B1220", ink: "#F1F5F9", ink2: "#CBD5E1", muted: "#94A3B8", hair: "#1F2A3D", border: "#64748B", line: "#A3B1C6",
  zoneFill: "#111A2C", zoneBorder: "#1F2A3D", nodeFill: "#172235", band: "#1F2A3D",
  accent: "#7AA5FF", accentSoft: "#18284A", onAccent: "#0B1220", pencil: "#64748B",
  tones: {
    neutral: { ink: "#F1F5F9", fill: "#1F2A3D" },
    warn: { ink: "#FBBF24", fill: "#3A2A0B" },
    danger: { ink: "#F87171", fill: "#3B1414" },
    ok: { ink: "#4ADE80", fill: "#0F2E1B" },
  },
  groups: { ...AWS_GROUPS, aws_cloud: "#E2E8F0", generic: "#94A3B8" },
};
