import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import Sidebar from "./components/Sidebar";
import AuthTokenProvider from "./components/AuthTokenProvider";

export const metadata: Metadata = {
  title: "PG Vitals — PostgreSQL Monitoring",
  description:
    "Real-time PostgreSQL connection monitoring, session analysis, and root-cause diagnostics.",
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
            <div className="app-layout">
              <Sidebar />
              <main className="main-content">{children}</main>
            </div>
          </AuthTokenProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
