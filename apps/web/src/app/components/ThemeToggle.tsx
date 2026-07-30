"use client";

import React, { useEffect, useState } from "react";

/* ===================================================================
   ThemeToggle — Switches between light, dark, and system theme
   =================================================================== */

type Theme = "light" | "dark" | "system";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem("pgvitals-theme") as Theme) || "system";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    applyTheme(stored);
    setMounted(true);
  }, []);

  function cycleTheme() {
    const order: Theme[] = ["light", "dark", "system"];
    const nextIndex = (order.indexOf(theme) + 1) % order.length;
    const next = order[nextIndex];
    setTheme(next);
    localStorage.setItem("pgvitals-theme", next);
    applyTheme(next);
  }

  // Prevent hydration mismatch — render a placeholder on server
  if (!mounted) {
    return (
      <button className="theme-toggle" aria-label="Toggle theme">
        <span style={{ fontSize: "0.85rem" }}>◐</span>
      </button>
    );
  }

  const icon =
    theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "◐";
  const label =
    theme === "light"
      ? "Light mode (click for dark)"
      : theme === "dark"
        ? "Dark mode (click for system)"
        : "System theme (click for light)";

  return (
    <button
      className="theme-toggle"
      onClick={cycleTheme}
      aria-label={label}
      title={label}
    >
      <span style={{ fontSize: "0.85rem", lineHeight: 1 }}>{icon}</span>
    </button>
  );
}
