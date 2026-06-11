import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Clerk protects all routes except the public ones:
 * - / (marketing landing)
 * - /login (Clerk sign-in)
 * - /api/bot/webhook (MeetingBaaS — authenticated via HMAC signature)
 * - /api/bot/pipecat-transcript (Pipecat sidecar — authenticated via bearer secret)
 * - /api/auth/webhook (Clerk — authenticated via svix signature)
 */
const isPublicRoute = createRouteMatcher([
  "/",
  "/login(.*)",
  "/api/bot/webhook(.*)",
  "/api/bot/pipecat-transcript(.*)",
  "/api/auth/webhook(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
