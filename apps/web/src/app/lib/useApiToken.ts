"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { setGlobalTokenGetter } from "./tokenStore";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Hook that returns a function to get the current Clerk session token,
 * plus an `isReady` flag indicating whether auth has finished loading.
 *
 * Also registers a global token getter so api.ts can auto-attach tokens.
 * The getter is registered synchronously via a ref (not useEffect) to
 * avoid race conditions where child components make API calls before
 * the parent's useEffect has run.
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

  // Store getToken in a ref so it's always the latest version
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  // Register the global token getter SYNCHRONOUSLY (during render)
  // This avoids the race condition where child useEffects fire before
  // this component's useEffect.
  if (isLoaded) {
    setGlobalTokenGetter(() => getTokenRef.current());
  }

  // Cleanup on unmount only
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    return () => {
      setGlobalTokenGetter(null);
    };
  }, []);

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
