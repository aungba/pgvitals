"use client";

import React from "react";
import Link from "next/link";
import { LogoIcon } from "./Logo";

export default function PublicFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer-content">
        <div className="landing-footer-brand">
          <div className="landing-brand">
            <LogoIcon size={32} />
            <span className="landing-brand-title">PG Vitals</span>
          </div>
          <p className="landing-footer-tagline">
            Real-time PostgreSQL observability, diagnostics, and root-cause alerts for modern engineering teams.
          </p>
        </div>

        <div className="landing-footer-links">
          <div className="footer-col">
            <h4>Product</h4>
            <Link href="/#features">Features</Link>
            <Link href="/#preview">Live Demo</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/security">Security</Link>
          </div>
          <div className="footer-col">
            <h4>Resources</h4>
            <Link href="/quickstart">Quickstart Guide</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/docs">Documentation</Link>
          </div>
          <div className="footer-col">
            <h4>Legal</h4>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/security">Security Overview</Link>
          </div>
        </div>
      </div>
      <div className="landing-footer-bottom">
        <div className="landing-container">
          <p>© {new Date().getFullYear()} PG Vitals. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
