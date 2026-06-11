import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { PageShell } from "@/components/layout/PageShell";

// Authed, per-user content — never prerender at build.
export const dynamic = "force-dynamic";

/**
 * Authenticated app layout. ClerkProvider lives here (not in the root
 * layout) so the public landing page stays statically buildable; all Clerk
 * hooks/components render inside this segment.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await auth.protect();

  return (
    <ClerkProvider>
      <PageShell>{children}</PageShell>
    </ClerkProvider>
  );
}
