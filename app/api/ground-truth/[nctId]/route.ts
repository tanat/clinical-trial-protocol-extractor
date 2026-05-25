import { NextResponse } from 'next/server';
import { readNormalized } from '@/lib/fixtures';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ nctId: string }> },
) {
  const { nctId } = await ctx.params;
  if (!/^NCT\d{8}$/.test(nctId)) {
    return NextResponse.json({ error: 'invalid NCT id' }, { status: 400 });
  }
  const normalized = await readNormalized(nctId);
  if (!normalized) {
    return NextResponse.json({ error: `no normalized ground truth for ${nctId}` }, { status: 404 });
  }
  return NextResponse.json({ trialId: nctId, normalized });
}
