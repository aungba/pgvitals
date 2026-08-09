/**
 * Global token store — provides Clerk JWT tokens for API calls.
 *
 * Primary: token getter registered by AuthTokenProvider (via useAuth hook)
 * Fallback: window.Clerk SDK (available after Clerk loads client-side)
 *
 * This file intentionally has NO "use client" directive so it can be
 * imported by both client and non-client modules.
 */

let globalTokenGetter: (() => Promise<string | null>) | null = null;

export function setGlobalTokenGetter(getter: (() => Promise<string | null>) | null) {
  globalTokenGetter = getter;
}

export async function getGlobalToken(): Promise<string | null> {
  // Primary path: use the registered getter from useAuth()
  if (globalTokenGetter) {
    try {
      return await globalTokenGetter();
    } catch {
      // fall through to fallback
    }
  }

  // Fallback: try window.Clerk directly (works once Clerk JS has loaded)
  if (typeof window !== "undefined") {
    try {
      const clerk = (window as any).Clerk;
      if (clerk?.session) {
        const token = await clerk.session.getToken();
        return token ?? null;
      }
    } catch {
      // Clerk not ready yet
    }
  }

  return null;
}
