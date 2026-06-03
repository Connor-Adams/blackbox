import Link from "next/link";

const LINKS: [string, string][] = [
  ["/today", "Today"],
  ["/timeline", "Timeline"],
  ["/insights", "Insights"],
  ["/sources", "Sources"],
];

export function Nav() {
  return (
    <nav className="border-b border-border">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-3 text-sm">
        <Link href="/today" className="font-semibold tracking-tight">Blackbox</Link>
        <div className="flex gap-3 text-muted-foreground">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-foreground">
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
