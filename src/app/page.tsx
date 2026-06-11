import Link from "next/link";
import { BotStatusBadge } from "@/components/bot/BotStatusBadge";

const FEATURES = [
  {
    title: "Joins your meetings",
    body: "An AI bot joins Zoom, Google Meet, and Teams calls, transcribes in real time, and knows which ritual it's in — standup, planning, or incident review.",
  },
  {
    title: "Builds shared memory",
    body: "Every transcript, decision, and resolved ticket is embedded into team-scoped semantic memory. Nothing your team figures out gets lost.",
  },
  {
    title: "Speaks up with receipts",
    body: "When the discussion matches a problem your team already solved, the bot raises its hand and shares the past fix — with links in chat.",
  },
] as const;

const LOOP_STEPS = [
  "Bot joins meeting",
  "Transcribes in real time",
  "Detects blockers",
  "Searches team memory",
  "Raises hand ✋",
  "Speaks the past fix",
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-brand-900 text-white">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-accent text-sm font-bold">
            In
          </div>
          <span className="text-sm font-semibold tracking-tight">Insider</span>
        </div>
        <Link
          href="/dashboard"
          className="rounded-md border border-white/15 px-4 py-1.5 text-sm font-medium text-zinc-200 transition-colors hover:border-white/30 hover:text-white"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
        <div className="max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300">
            <BotStatusBadge status="listening" />
            <span>in your standup right now</span>
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            The AI PM that remembers everything{" "}
            <span className="text-brand-accent">your team already solved.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-zinc-400">
            Insider sits in your meetings, builds a shared memory from every
            call and ticket, and speaks up the moment a discussion matches a
            problem your team has already fixed.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-md bg-brand-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-accent/90"
            >
              Get started
            </Link>
            <Link
              href="/dashboard"
              className="rounded-md border border-white/15 px-6 py-3 text-sm font-medium text-zinc-200 transition-colors hover:border-white/30 hover:text-white"
            >
              Open dashboard
            </Link>
          </div>
        </div>

        {/* Core loop strip */}
        <div className="mt-16 overflow-x-auto">
          <div className="flex min-w-max items-center gap-3 rounded-lg border border-white/10 bg-brand-800/60 px-5 py-4 font-mono text-xs text-zinc-400">
            {LOOP_STEPS.map((step, i) => (
              <span key={step} className="flex items-center gap-3">
                <span className={i === 4 ? "text-brand-accent" : undefined}>
                  {step}
                </span>
                {i < LOOP_STEPS.length - 1 && (
                  <span className="text-zinc-600">→</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-white/5 bg-brand-800/40">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 py-16 md:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-white/10 bg-brand-700/40 p-6"
            >
              <h3 className="text-sm font-semibold text-white">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-xs text-zinc-500">
        <span>© {new Date().getFullYear()} Insider</span>
        <span className="font-mono">built for engineering teams</span>
      </footer>
    </div>
  );
}
