import type { ReactNode } from "react";

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconMic = () => <Svg><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
export const IconStop = () => <Svg><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>;
export const IconImport = () => <Svg><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>;
export const IconExport = () => <Svg><path d="M12 15V4M7 9l5-5 5 5M5 20h14" /></Svg>;
export const IconWave = () => <Svg><path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 10v4M21 12h0" /></Svg>;
export const IconDoc = () => <Svg><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Svg>;
export const IconUndo = () => <Svg><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></Svg>;
export const IconGear = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>;
export const IconBars = () => <Svg><path d="M5 20V10M12 20V4M19 20v-7" /></Svg>;
export const IconClose = () => <Svg size={16}><path d="M6 6l12 12M18 6L6 18" /></Svg>;
export const IconWand = () => <Svg size={14}><path d="M15 4V2M15 10V8M11 6H9M21 6h-2M18 3l-1 1M18 9l-1-1M4 20L16 8l-1-1L3 19z" /></Svg>;
export const IconPlay = () => <Svg><path d="M7 4l13 8-13 8z" /></Svg>;
export const IconPause = () => <Svg><path d="M8 5v14M16 5v14" /></Svg>;
export const IconTrash = () => <Svg><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>;
export const IconChevron = ({ up }: { up?: boolean }) => <Svg size={16}><path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></Svg>;
export const IconRestart = () => <Svg><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></Svg>;

export function Logo() {
  return (
    <svg width="28" height="24" viewBox="0 0 120 100" aria-hidden="true" style={{ overflow: "visible" }}>
      <circle cx="22" cy="28" r="9" fill="#2A2A2E" />
      <path d="M22 28 C 22 62, 60 74, 70 46 C 77 26, 50 14, 44 40 C 38 66, 70 96, 112 68" fill="none" stroke="#2A2A2E" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
