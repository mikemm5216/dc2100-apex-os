import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-neutral-800 pb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
            DC 2100
          </p>

          <h1 className="mt-2 text-4xl font-semibold tracking-tight">
            APEX OS
          </h1>

          <p className="mt-3 max-w-2xl text-neutral-400">
            Content intelligence, creative production, publishing, and analytics
            control system for the DC 2100 universe.
          </p>
        </header>

        <section className="mt-8">
          <Link
            href="/dashboard"
            className="inline-flex rounded-lg bg-white px-5 py-3 text-sm font-medium text-black transition hover:bg-neutral-200"
          >
            Open Dashboard
          </Link>
        </section>
      </div>
    </main>
  );
}
