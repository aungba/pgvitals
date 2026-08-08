"use client";

import { useApiToken } from "../lib/useApiToken";

/**
 * Invisible client component that initializes the global Clerk token getter.
 * Must be rendered inside ClerkProvider so useAuth() works.
 * This ensures api.ts can auto-attach Bearer tokens to all requests.
 */
export default function AuthTokenProvider({ children }: { children: React.ReactNode }) {
  // This hook registers the global token getter as a side effect
  useApiToken();
  return <>{children}</>;
}
