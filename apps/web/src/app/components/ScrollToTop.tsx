"use client";

import React, { useEffect, useState } from "react";

/* ===================================================================
   ScrollToTop — Floating pill button to smoothly return to top
   =================================================================== */

export default function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function handleScroll() {
      if (window.scrollY > 350) {
        setVisible(true);
      } else {
        setVisible(false);
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="btn-secondary"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        borderRadius: "var(--radius-full)",
        boxShadow: "var(--shadow-lg)",
        backdropFilter: "blur(12px)",
        background: "color-mix(in srgb, var(--surface) 90%, transparent)",
        border: "1px solid var(--border)",
        fontSize: "0.8rem",
        fontWeight: 600,
        color: "var(--text-primary)",
        cursor: "pointer",
        transition: "all var(--transition-fast)",
      }}
      title="Scroll back to top"
    >
      <span style={{ fontSize: "0.9rem" }}>↑</span> Top
    </button>
  );
}
