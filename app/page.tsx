import Link from 'next/link';
import { Extractor } from './extractor';
import { listFixtures } from '@/lib/fixtures';

export default async function Home() {
  const fixtures = await listFixtures();
  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-6 sm:mb-10 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            Structured extraction · schema-validated · scored
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Clinical Trial Protocol Extractor
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            Extract structured protocol fields from a ClinicalTrials.gov detailed description and
            compare them against the normalized ground truth.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-2 sm:justify-end">
          <NavLink href="/research">Research</NavLink>
          <NavLink href="/search">Search</NavLink>
          <NavLink href="/eval">Eval results</NavLink>
        </nav>
      </header>
      <Extractor fixtures={fixtures} />
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1 rounded-lg border border-border bg-card/60 px-3 py-1.5 text-sm font-medium text-foreground/80 shadow-sm backdrop-blur transition-colors hover:border-primary/40 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
      <span aria-hidden className="text-muted-foreground transition-transform group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}
