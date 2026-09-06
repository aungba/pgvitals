"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";
import { docCategories, docSections, DocSection } from "./docsData";

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("onboarding");
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Sync with URL hash on mount and hashchange
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash && docSections.some((s) => s.id === hash)) {
        setActiveSection(hash);
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const handleSelectSection = (id: string) => {
    setActiveSection(id);
    setMobileMenuOpen(false);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${id}`);
      window.scrollTo({ top: 140, behavior: "smooth" });
    }
  };

  const query = searchQuery.trim().toLowerCase();

  const filteredSections = docSections.filter((s) => {
    if (!query) return true;
    return (
      s.title.toLowerCase().includes(query) ||
      s.category.toLowerCase().includes(query) ||
      s.keywords.toLowerCase().includes(query)
    );
  });

  const currentIndex = docSections.findIndex((s) => s.id === activeSection);
  const currentSection = docSections[currentIndex] || docSections[0];

  const prevSection = currentIndex > 0 ? docSections[currentIndex - 1] : null;
  const nextSection =
    currentIndex < docSections.length - 1 ? docSections[currentIndex + 1] : null;

  return (
    <div className="landing-root">
      <div className="landing-glow-blob landing-glow-1" />
      <div className="landing-glow-blob landing-glow-2" />

      <PublicNav />

      <main className="docs-wrapper">
        {/* Header Hero */}
        <div className="docs-header-hero">
          <div className="landing-hero-badge">
            <span>📖 PG Vitals End User Guide</span>
          </div>
          <h1>Documentation &amp; Feature Guide</h1>
          <p>
            Learn how to navigate, interpret, and resolve PostgreSQL performance bottlenecks with PG Vitals.
          </p>
        </div>

        {/* Mobile Topic Switcher */}
        <div className="docs-mobile-nav-bar">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="docs-mobile-nav-toggle"
            aria-expanded={mobileMenuOpen}
          >
            <div className="docs-mobile-nav-info">
              <span className="docs-mobile-nav-label">Current Topic</span>
              <span className="docs-mobile-nav-title">{currentSection.title}</span>
            </div>
            <span className="docs-mobile-nav-btn">
              {mobileMenuOpen ? "Close Menu ✕" : "Browse Topics ▾"}
            </span>
          </button>
        </div>

        {/* Layout Grid */}
        <div className="docs-layout-grid">
          {/* Left Sidebar */}
          <aside className={`docs-sidebar ${mobileMenuOpen ? "mobile-open" : ""}`}>
            <div className="docs-search-wrap">
              <span className="docs-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search topics, queries, hypopg..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="docs-search-input"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    padding: "0 4px",
                  }}
                  title="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            {filteredSections.length === 0 ? (
              <div style={{ padding: "16px 8px", fontSize: "0.88rem", color: "var(--text-muted)" }}>
                No topics matching &ldquo;{searchQuery}&rdquo;.
              </div>
            ) : (
              docCategories.map((cat) => {
                const catSections = filteredSections.filter((s) => s.category === cat);
                if (catSections.length === 0) return null;

                return (
                  <div key={cat} className="docs-nav-group">
                    <div className="docs-nav-group-title">{cat}</div>
                    {catSections.map((s) => {
                      const isActive = currentSection.id === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => handleSelectSection(s.id)}
                          className={`docs-nav-item ${isActive ? "active" : ""}`}
                        >
                          <span>{s.title}</span>
                          {s.badge && (
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: "0.68rem",
                                padding: "2px 6px",
                                borderRadius: "6px",
                                background: isActive
                                  ? "rgba(255,255,255,0.2)"
                                  : "var(--surface-alt)",
                                color: isActive ? "#ffffff" : "var(--brand)",
                                fontWeight: 600,
                              }}
                            >
                              {s.badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <Link
                href="/quickstart"
                style={{
                  fontSize: "0.86rem",
                  color: "var(--brand)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                  marginBottom: 8,
                  fontWeight: 500,
                }}
              >
                <span>🚀</span> Quickstart Guide →
              </Link>
              <Link
                href="/faq"
                style={{
                  fontSize: "0.86rem",
                  color: "var(--brand)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                <span>❓</span> FAQ →
              </Link>
            </div>
          </aside>

          {/* Right Main Article */}
          <article className="docs-article animate-fade-in" key={currentSection.id}>
            {currentSection.content}

            {/* Sequential Navigation between features */}
            <div
              className="docs-nav-sequential"
              style={{
                marginTop: 48,
                paddingTop: 24,
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              {prevSection ? (
                <button
                  onClick={() => handleSelectSection(prevSection.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "10px 16px",
                    cursor: "pointer",
                    textAlign: "left",
                    color: "var(--text-primary)",
                    transition: "all var(--transition-fast)",
                  }}
                >
                  <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                    ← Previous Feature
                  </span>
                  <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "var(--brand)" }}>
                    {prevSection.title}
                  </span>
                </button>
              ) : (
                <div />
              )}

              {nextSection && (
                <button
                  onClick={() => handleSelectSection(nextSection.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    background: "var(--surface-alt)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "10px 16px",
                    cursor: "pointer",
                    textAlign: "right",
                    color: "var(--text-primary)",
                    transition: "all var(--transition-fast)",
                    marginLeft: "auto",
                  }}
                >
                  <span style={{ fontSize: "0.74rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                    Next Feature →
                  </span>
                  <span style={{ fontSize: "0.92rem", fontWeight: 600, color: "var(--brand)" }}>
                    {nextSection.title}
                  </span>
                </button>
              )}
            </div>
          </article>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}
