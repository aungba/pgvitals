import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest, NextFetchEvent } from "next/server";

const isE2ETest = process.env.NEXT_PUBLIC_E2E === "true" || process.env.PLAYWRIGHT_TEST === "true";
const clerkEnabled = !isE2ETest && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

const isPublicRoute = createRouteMatcher([
  "/",
  "/landing",
  "/quickstart(.*)",
  "/faq(.*)",
  "/docs(.*)",
  "/privacy(.*)",
  "/terms(.*)",
  "/security(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
]);

const protectedMiddleware = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect({
      unauthenticatedUrl: new URL("/sign-in", req.url).toString(),
    });
  }
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  // Dev mode — no auth, let everything through
  if (!clerkEnabled) {
    return NextResponse.next();
  }

  // Production mode — enforce login for protected routes
  return protectedMiddleware(request, event);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};

