import type { ReactNode } from "react";

type SectionPageProps = {
  title: string;
  description: string;
  children?: ReactNode;
};

export function SectionPage({
  title,
  description,
  children,
}: SectionPageProps) {
  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-neutral-800 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">
            {title}
          </h1>

          <p className="mt-2 text-sm text-neutral-400">
            {description}
          </p>
        </header>

        <section className="mt-8 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/50">
          {children ?? (
            <div className="p-6">
              <p className="text-sm text-neutral-500">
                DC 2100 APEX OS · MVP Module
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
