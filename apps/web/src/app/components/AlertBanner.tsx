"use client";

import React from "react";
import Link from "next/link";
import type { Alert } from "../lib/api";

/* ===================================================================
   AlertBanner — Shows active alert summary on database detail page
   =================================================================== */

interface AlertBannerProps {
  alerts: Alert[];
  databaseId: string;
}

export default function AlertBanner({ alerts, databaseId }: AlertBannerProps) {
  if (alerts.length === 0) return null;

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  const isCritical = criticalCount > 0;

  return (
    <Link
      href={`/databases/${databaseId}/alerts`}
      className={`alert-banner ${isCritical ? "alert-banner-critical" : "alert-banner-warning"}`}
    >
      <div className="alert-banner-icon">
        {isCritical ? "🔴" : "🟡"}
      </div>
      <div className="alert-banner-content">
        <strong>
          {alerts.length} active alert{alerts.length !== 1 ? "s" : ""}
        </strong>
        <span className="alert-banner-detail">
          {criticalCount > 0 && `${criticalCount} critical`}
          {criticalCount > 0 && warningCount > 0 && ", "}
          {warningCount > 0 && `${warningCount} warning`}
          {" · Click to manage"}
        </span>
      </div>
      <span className="alert-banner-arrow">→</span>
    </Link>
  );
}
