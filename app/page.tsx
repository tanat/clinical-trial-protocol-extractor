import Link from 'next/link';
import { Extractor } from './extractor';
import { listFixtures } from '@/lib/fixtures';

export default async function Home() {
  const fixtures = await listFixtures();
  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clinical Trial Protocol Extractor</h1>
          <p className="text-sm text-muted-foreground">
            Extract structured Protocol fields from a ClinicalTrials.gov detailed description and compare against the
            normalized ground truth.
          </p>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/research" className="underline-offset-4 hover:underline">
            Research →
          </Link>
          <Link href="/search" className="underline-offset-4 hover:underline">
            Search →
          </Link>
          <Link href="/eval" className="underline-offset-4 hover:underline">
            Eval results →
          </Link>
        </nav>
      </header>
      <Extractor fixtures={fixtures} />
    </div>
  );
}
