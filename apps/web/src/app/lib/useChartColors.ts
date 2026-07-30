"use client";
import { useState, useEffect } from "react";

export interface ChartColors {
  healthy: string;
  idle: string;
  warning: string;
  critical: string;
  textMuted: string;
  textSecondary: string;
  textPrimary: string;
  border: string;
  surface: string;
  surfaceAlt: string;
  brand: string;
}

function readCSSVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>({
    healthy: "#1F9D6B",
    idle: "#7C6FC9",
    warning: "#C98A1B",
    critical: "#C24B3F",
    textMuted: "#8494A3",
    textSecondary: "#4C5D6B",
    textPrimary: "#14202B",
    border: "#D8E0E8",
    surface: "#FFFFFF",
    surfaceAlt: "#EDF1F5",
    brand: "#1D6F8C",
  });

  useEffect(() => {
    function update() {
      setColors({
        healthy: readCSSVar("--signal-healthy") || "#1F9D6B",
        idle: readCSSVar("--signal-idle") || "#7C6FC9",
        warning: readCSSVar("--signal-warning") || "#C98A1B",
        critical: readCSSVar("--signal-critical") || "#C24B3F",
        textMuted: readCSSVar("--text-muted") || "#8494A3",
        textSecondary: readCSSVar("--text-secondary") || "#4C5D6B",
        textPrimary: readCSSVar("--text-primary") || "#14202B",
        border: readCSSVar("--border") || "#D8E0E8",
        surface: readCSSVar("--surface") || "#FFFFFF",
        surfaceAlt: readCSSVar("--surface-alt") || "#EDF1F5",
        brand: readCSSVar("--brand") || "#1D6F8C",
      });
    }

    update();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "data-theme") {
          // Small delay to let CSS variables update
          requestAnimationFrame(update);
        }
      }
    });

    observer.observe(document.documentElement, { attributes: true });
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    mql.addEventListener("change", update);

    return () => {
      observer.disconnect();
      mql.removeEventListener("change", update);
    };
  }, []);

  return colors;
}
