"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { LogoIcon } from "./Logo";
import ThemeToggle from "./ThemeToggle";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function PublicNav() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();

  const navLinks = [
    { href: "/#features", label: "Features" },
    { href: "/quickstart", label: "Quickstart" },
    { href: "/faq", label: "FAQ" },
    { href: "/docs", label: "Documentation" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/security", label: "Security" },
  ];

  return (
    <header className="landing-nav">
      <div className="landing-nav-container">
        <Link href="/" className="landing-brand">
          <LogoIcon size={34} />
          <span className="landing-brand-title">PG Vitals</span>
        </Link>

        <nav className="landing-nav-links">
          {navLinks.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`landing-nav-link ${isActive ? "active font-semibold text-brand" : ""}`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="landing-nav-actions">
          <ThemeToggle />
          {clerkEnabled ? (
            isSignedIn ? (
              <Link href="/" className="landing-cta-btn">
                <span>Go to Dashboard</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="landing-login-btn">
                  Sign In
                </Link>
                <Link href="/sign-up" className="landing-cta-btn">
                  <span>Start Free</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </Link>
              </>
            )
          ) : (
            <Link href="/" className="landing-cta-btn">
              <span>Open Dashboard</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
