import React from "react";

interface LogoProps {
  size?: number | "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  animated?: boolean;
}

const SIZE_MAP = {
  sm: 24,
  md: 32,
  lg: 36,
  xl: 44,
};

export function LogoIcon({
  size = 36,
  className = "",
  animated = false,
}: {
  size?: number | "sm" | "md" | "lg" | "xl";
  className?: string;
  animated?: boolean;
}) {
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size] || 36;
  const strokeWidth = pixelSize <= 24 ? 2.2 : 2.5;

  return (
    <div
      className={`sidebar-logo-icon ${className}`}
      style={{
        width: `${pixelSize}px`,
        height: `${pixelSize}px`,
        minWidth: `${pixelSize}px`,
        minHeight: `${pixelSize}px`,
      }}
    >
      <svg
        width={Math.round(pixelSize * 0.62)}
        height={Math.round(pixelSize * 0.62)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={animated ? "logo-pulse-anim" : undefined}
      >
        {/* Subtle Database Disc Background Accent */}
        <ellipse
          cx="12"
          cy="6.5"
          rx="5.5"
          ry="2"
          fill="rgba(255, 255, 255, 0.2)"
          stroke="none"
        />
        <path
          d="M6.5 6.5v3.5c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V6.5"
          stroke="rgba(255, 255, 255, 0.35)"
          strokeWidth="1.2"
          fill="none"
        />

        {/* Crisp ECG Lifeline Pulse */}
        <path
          d="M2 13h4l2.5-6.5L12 19l3-9.5 2.5 3.5H22"
          stroke="white"
          strokeWidth={strokeWidth}
        />
      </svg>
    </div>
  );
}

export default function Logo({
  size = "lg",
  showText = true,
  className = "",
  iconClassName = "",
  textClassName = "",
  animated = false,
}: LogoProps) {
  return (
    <div
      className={`sidebar-logo ${className}`}
      style={!showText ? { paddingBottom: 0, borderBottom: "none", marginBottom: 0 } : undefined}
    >
      <LogoIcon size={size} className={iconClassName} animated={animated} />
      {showText && (
        <span className={`sidebar-logo-text ${textClassName}`}>
          PG <span style={{ color: "var(--brand)" }}>Vitals</span>
        </span>
      )}
    </div>
  );
}
