"use client";

import { useCallback } from "react";
import { useAuth } from "@clerk/nextjs";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Hook that returns a function to get the current Clerk session token,
 * plus an `isReady` flag indicating whether auth has finished loading.
 *
 * Pages should wait for `isReady` before making API calls.
 */
export function useApiToken(): { getToken: () => Promise<string | undefined>; isReady: boolean } {
  if (!clerkEnabled) {
    // Dev mode — no auth tokens needed, always ready
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const fn = useCallback(async (): Promise<string | undefined> => {
      return undefined;
    }, []);
    return { getToken: fn, isReady: true };
  }

  // Production mode — use Clerk's useAuth hook
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getToken, isLoaded } = useAuth();

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fn = useCallback(async (): Promise<string | undefined> => {
    if (!isLoaded) return undefined;
    try {
      const token = await getToken();
      return token ?? undefined;
    } catch {
      return undefined;
    }
  }, [getToken, isLoaded]);

  return { getToken: fn, isReady: isLoaded };
}
