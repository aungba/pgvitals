"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { UserButton, useAuth } from "@clerk/nextjs";
import ThemeToggle from "./ThemeToggle";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function ClerkUserSection() {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return null;
  return <UserButton />;
}



/* ===================================================================
   Sidebar — Collapsible navigation sidebar
   
   Collapsed state is driven entirely via the `data-sidebar` attribute
   on <html>. An inline script in layout.tsx sets this attribute BEFORE
   React hydrates, so CSS applies the collapsed layout instantly with
   no flash. React just manages toggling and localStorage persistence.
   =================================================================== */

const STORAGE_KEY = "pgvitals-sidebar-collapsed";

function getCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function SidebarLink({
  href,
  icon,
  label,
  collapsed,
}: {
  href: string;
  icon: string;
  label: string;
  collapsed: boolean;
}) {
  const iconSvg =
    icon === "dashboard" ? (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ) : icon === "settings" ? (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ) : icon === "team" ? (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ) : icon === "landing" ? (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ) : (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    );

  return (
    <Link href={href} className="sidebar-link" title={collapsed ? label : undefined}>
      <span className="sidebar-link-icon">{iconSvg}</span>
      <span className="sidebar-link-label">{label}</span>
    </Link>
  );
}

export default function Sidebar() {
  // State is only used for the toggle chevron direction and tooltip text.
  // All visual styling comes from [data-sidebar="collapsed"] CSS selectors
  // which are driven by the data attribute on <html>.
  const [collapsed, setCollapsed] = useState(false);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      // Update the data attribute — this is what drives all CSS
      document.documentElement.setAttribute(
        "data-sidebar",
        next ? "collapsed" : "expanded"
      );
      return next;
    });
  }, []);

  // On mount, ensure the data attribute matches localStorage
  // (the inline script already did this, but this covers edge cases)
  // Then remove data-no-transition to enable CSS transitions for user interactions.
  useEffect(() => {
    const isCollapsed = getCollapsed();
    setCollapsed(isCollapsed);
    document.documentElement.setAttribute(
      "data-sidebar",
      isCollapsed ? "collapsed" : "expanded"
    );
    // Wait one frame so the browser paints the correct state,
    // then enable transitions for future interactions
    requestAnimationFrame(() => {
      document.documentElement.removeAttribute("data-no-transition");
    });
  }, []);

  return (
    <>
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <span className="sidebar-logo-text">PG Vitals</span>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          <SidebarLink href="/" icon="dashboard" label="Dashboard" collapsed={collapsed} />
          <SidebarLink href="/databases/new" icon="add" label="Add Database" collapsed={collapsed} />
          <SidebarLink href="/settings/billing" icon="settings" label="Billing" collapsed={collapsed} />
          <SidebarLink href="/settings/team" icon="team" label="Team" collapsed={collapsed} />
          <SidebarLink href="/landing" icon="landing" label="Public Site" collapsed={collapsed} />
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {clerkEnabled && <ClerkUserSection />}
            <span className="sidebar-footer-version">PG Vitals v0.1.0</span>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {/* Collapse toggle — outside aside to avoid overflow clipping */}
      <button
        className="sidebar-toggle"
        onClick={toggle}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            transform: collapsed ? "rotate(180deg)" : "none",
            transition: "transform 0.2s ease",
          }}
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    </>
  );
}
