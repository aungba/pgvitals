/**
 * Global token store — a simple module-level variable that holds
 * a reference to the Clerk getToken function.
 *
 * Set by AuthTokenProvider (client component inside ClerkProvider).
 * Read by api.ts request() to auto-attach Bearer tokens.
 *
 * This file intentionally has NO "use client" directive so it can be
 * imported by both client and non-client modules.
 */

let globalTokenGetter: (() => Promise<string | null>) | null = null;

export function setGlobalTokenGetter(getter: (() => Promise<string | null>) | null) {
  globalTokenGetter = getter;
}

export async function getGlobalToken(): Promise<string | null> {
  if (globalTokenGetter) return globalTokenGetter();
  return null;
}
