import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import AppShell from "./components/AppShell";
import AuthTokenProvider from "./components/AuthTokenProvider";
import QueryProvider from "./components/QueryProvider";

export const metadata: Metadata = {
  title: "PG Vitals — PostgreSQL Monitoring & Diagnostics",
  description:
    "Real-time PostgreSQL connection monitoring, session analysis, index & vacuum advisors, and root-cause diagnostics.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.svg",
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link
            href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
            rel="stylesheet"
          />
          {/* Prevent FOUC — apply stored theme/sidebar state and suppress transitions before first paint */}
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var d=document.documentElement;d.setAttribute('data-no-transition','');try{var t=localStorage.getItem('pgvitals-theme');if(t==='light'||t==='dark')d.setAttribute('data-theme',t);var s=localStorage.getItem('pgvitals-sidebar-collapsed');if(s==='true')d.setAttribute('data-sidebar','collapsed')}catch(e){}})();`,
            }}
          />
        </head>
        <body>
          <AuthTokenProvider>
            <QueryProvider>
              <AppShell>{children}</AppShell>
            </QueryProvider>
          </AuthTokenProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
