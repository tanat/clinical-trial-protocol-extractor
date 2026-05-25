// Tiny recursive renderer for JSON-y values. No external deps.
// Renders strings, numbers, booleans, null, arrays, and plain objects.
// Differences from JSON.stringify: collapsible rows, color-coded leaves,
// stable rendering when the value is `unknown`.

'use client';

import { useState } from 'react';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function JsonTree({ value, name }: { value: unknown; name?: string }) {
  return (
    <div className="font-mono text-xs leading-5">
      <Node value={value as Json} name={name} depth={0} />
    </div>
  );
}

function Node({ value, name, depth }: { value: Json; name?: string; depth: number }) {
  if (value === null) return <Leaf name={name} text="null" tone="muted" />;
  if (typeof value === 'string') return <Leaf name={name} text={`"${value}"`} tone="string" />;
  if (typeof value === 'number') return <Leaf name={name} text={String(value)} tone="number" />;
  if (typeof value === 'boolean') return <Leaf name={name} text={String(value)} tone="bool" />;
  if (Array.isArray(value)) return <Branch name={name} entries={value.map((v, i) => [String(i), v])} bracket={['[', ']']} depth={depth} />;
  if (typeof value === 'object') {
    return <Branch name={name} entries={Object.entries(value)} bracket={['{', '}']} depth={depth} />;
  }
  return <Leaf name={name} text={String(value)} tone="muted" />;
}

function Leaf({ name, text, tone }: { name?: string; text: string; tone: 'string' | 'number' | 'bool' | 'muted' }) {
  const toneClass =
    tone === 'string'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'number'
        ? 'text-amber-600 dark:text-amber-400'
        : tone === 'bool'
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-zinc-500';
  return (
    <div className="pl-4">
      {name !== undefined && <span className="text-zinc-500">{name}: </span>}
      <span className={toneClass}>{text}</span>
    </div>
  );
}

function Branch({
  name,
  entries,
  bracket,
  depth,
}: {
  name?: string;
  entries: Array<[string, Json]>;
  bracket: [string, string];
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  const summary = entries.length === 0 ? `${bracket[0]}${bracket[1]}` : `${bracket[0]}${entries.length}${bracket[1]}`;
  return (
    <div className="pl-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        {name !== undefined ? `${name}: ` : ''}
        <span className="text-zinc-400">{open ? bracket[0] : summary}</span>
      </button>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
          <div className="pl-0 text-zinc-400">{bracket[1]}</div>
        </>
      )}
    </div>
  );
}
