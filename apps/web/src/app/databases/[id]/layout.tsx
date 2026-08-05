"use client";

import React from "react";
import DatabaseNav from "../../components/DatabaseNav";

/* ===================================================================
   Database Detail Layout — wraps all /databases/[id]/* pages with
   a sticky tab navigation bar for quick switching between subpages.
   =================================================================== */

export default function DatabaseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <DatabaseNav />
      {children}
    </>
  );
}
