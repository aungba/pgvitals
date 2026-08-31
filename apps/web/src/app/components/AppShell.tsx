"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Sidebar from "./Sidebar";
import ScrollToTop from "./ScrollToTop";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();

  // Public/marketing or standalone routes that should not display the dashboard sidebar
  const isStandaloneRoute =
    pathname === "/landing" ||
    pathname?.startsWith("/quickstart") ||
    pathname?.startsWith("/faq") ||
    pathname?.startsWith("/docs") ||
    pathname?.startsWith("/privacy") ||
    pathname?.startsWith("/terms") ||
    pathname?.startsWith("/security") ||
    pathname?.startsWith("/sign-in") ||
    pathname?.startsWith("/sign-up") ||
    (pathname === "/" && clerkEnabled && !isSignedIn);

  if (isStandaloneRoute) {
    return <>{children}</>;
  }

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {children}
        <ScrollToTop />
      </main>
    </div>
  );
}
