import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const clerkEnabled = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default async function middleware(request: NextRequest) {
  // Dev mode — no auth, let everything through
  if (!clerkEnabled) {
    return NextResponse.next();
  }

  // Production mode — use standard Clerk middleware
  const { clerkMiddleware } = await import("@clerk/nextjs/server");
  return clerkMiddleware()(request, {} as any);
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
