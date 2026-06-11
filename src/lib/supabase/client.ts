import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

/**
 * Browser-safe Supabase client (anon key only).
 * Use inside client components and hooks.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
