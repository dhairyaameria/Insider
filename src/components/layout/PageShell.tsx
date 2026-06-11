import { Sidebar } from "./Sidebar";

/**
 * Shell for all authenticated pages: fixed sidebar + offset main content
 * area on the surface background.
 */
export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface text-foreground">
      <Sidebar />
      <main className="pl-16 md:pl-60">
        <div className="mx-auto w-full max-w-6xl px-6 py-8 md:px-10">
          {children}
        </div>
      </main>
    </div>
  );
}
