"use client";

import { useCallback } from "react";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Hook that returns a function to get the current Clerk session token.
 * Returns undefined if auth is not configured (dev mode fallback).
 */
export function useApiToken() {
  if (!clerkEnabled) {
    // Dev mode — no auth tokens needed
    return useCallback(async (): Promise<string | undefined> => {
      return undefined;
    }, []);
  }

  // Production mode — use Clerk's useAuth hook
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useClerkToken();
}

function useClerkToken() {
  // Dynamic require to avoid importing @clerk/nextjs when not configured
  const { useAuth } = require("@clerk/nextjs");
  const { getToken, isLoaded } = useAuth();

  return useCallback(async (): Promise<string | undefined> => {
    if (!isLoaded) return undefined;
    try {
      const token = await getToken();
      return token ?? undefined;
    } catch {
      return undefined;
    }
  }, [getToken, isLoaded]);
}
