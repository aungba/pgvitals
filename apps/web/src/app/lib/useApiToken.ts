"use client";

import { useCallback, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { setGlobalTokenGetter } from "./tokenStore";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Hook that returns a function to get the current Clerk session token,
 * plus an `isReady` flag indicating whether auth has finished loading.
 *
 * Also registers a global token getter so api.ts can auto-attach tokens.
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

  // Register the global token getter so api.ts can use it
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (isLoaded) {
      setGlobalTokenGetter(getToken);
    }
    return () => {
      setGlobalTokenGetter(null);
    };
  }, [getToken, isLoaded]);

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
