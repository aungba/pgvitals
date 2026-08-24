"use client";

import React from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

/* ===================================================================
   DatabaseNav — Tab bar for navigating between database subpages.
   Renders on every /databases/[id]/* page via the segment layout.
   =================================================================== */

const tabs = [
  { label: "Overview", segment: "", icon: "📊" },
  { label: "Hints", segment: "/hints", icon: "💡" },
  { label: "Queries", segment: "/queries", icon: "🔍" },
  { label: "Indexes", segment: "/indexes", icon: "📇" },
  { label: "Health", segment: "/health", icon: "💚" },
  { label: "Alerts", segment: "/alerts", icon: "🔔" },
  { label: "Logs", segment: "/logs", icon: "📋" },
  { label: "Costs", segment: "/costs", icon: "💰" },
  { label: "Plans", segment: "/plans", icon: "📈" },
  { label: "Schema", segment: "/schema", icon: "🏗️" },
  { label: "Pooler", segment: "/pooler", icon: "🔀" },
];

export default function DatabaseNav() {
  const params = useParams();
  const pathname = usePathname();
  const dbId = params.id as string;
  const basePath = `/databases/${dbId}`;

  return (
    <nav className="db-nav" aria-label="Database navigation">
      <div className="db-nav-tabs">
        {tabs.map((tab) => {
          const href = `${basePath}${tab.segment}`;
          // Exact match for overview, prefix match for others
          const isActive = tab.segment === ""
            ? pathname === basePath || pathname === `${basePath}/`
            : pathname.startsWith(href);

          return (
            <Link
              key={tab.segment || "overview"}
              href={href}
              className={`db-nav-tab${isActive ? " db-nav-tab--active" : ""}`}
            >
              <span className="db-nav-tab-icon">{tab.icon}</span>
              <span className="db-nav-tab-label">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
