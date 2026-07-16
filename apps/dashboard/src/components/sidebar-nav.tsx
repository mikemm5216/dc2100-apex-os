import Link from "next/link";

const navigation = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Signals", href: "/signals" },
  { label: "Country News", href: "/country-news" },
  { label: "People Radar", href: "/person-radar" },
  { label: "Candidates", href: "/candidates" },
  { label: "Creative Packs", href: "/creative-packs" },
  { label: "Story Directions (Gate 2)", href: "/generation-queue" },
  { label: "Outline & Script (Gate 3/4)", href: "/story-outline-script-review" },
  { label: "Publish Queue", href: "/publish-queue" },
  { label: "Analytics", href: "/analytics" },
];

export function SidebarNav() {
  return (
    <aside className="min-h-screen w-64 border-r border-neutral-800 bg-neutral-950 p-6 text-white">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-500">
          DC 2100
        </p>

        <h1 className="mt-2 text-xl font-semibold">
          APEX OS
        </h1>
      </div>

      <nav className="space-y-2">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-lg px-3 py-2 text-sm text-neutral-300 transition hover:bg-neutral-900 hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
