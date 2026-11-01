export type Status = 'verified' | 'stale' | 'ambiguous' | 'missing' | 'unavailable';
export interface Snapshot { path: string; content: string; hash: string }
export interface Revision { at: string; path: string; hash: string; action: 'capture' | 'revalidate' | 'rebind' }
export interface Anchor {
  id: string; sourceId: string; sourcePath: string; sourceHash: string;
  quote: string; quoteHash: string; prefix: string; suffix: string; start: number;
  capturedAt: string; validatedAt: string; revisions: Revision[];
}
export interface Store { schema: 1; anchors: Anchor[] }
export interface Coverage { complete: boolean; failedPaths?: string[] }
export interface Assessment {
  status: Status; reason: string; canRevalidate: boolean;
  path?: string; hash?: string; start?: number; candidates?: string[];
}
const HASH = /^[a-f0-9]{64}$/;
const MAX_ANCHORS = 2000;
export const MAX_QUOTE = 8000;
export const CONTEXT = 64;
export function supported(path: string): boolean { return /\.(md|txt)$/i.test(path); }
function validPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 4096 &&
    !/[\x00-\x1f\\]/.test(path) && !path.startsWith('/') && !/^[A-Za-z]:/.test(path) &&
    !path.split('/').some(p => p === '..' || p === '.' || !p);
}
export async function hashText(text: string): Promise<string> {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('Ill-formed UTF-16 source text cannot be hashed without replacement.');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error('Ill-formed UTF-16 source text cannot be hashed without replacement.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function appendRevision(revisions: Revision[], next: Revision): Revision[] {
  return revisions.length < 100 ? [...revisions, next] : [revisions[0], ...revisions.slice(-98), next];
}
export async function snapshot(path: string, content: string): Promise<Snapshot> {
  if (!validPath(path) || !supported(path)) throw new Error('Only vault-relative .md and .txt sources are supported. PDF anchors are not supported.');
  return { path, content, hash: await hashText(content) };
}
export async function capture(doc: Snapshot, quote: string, start: number, sourceId: string = crypto.randomUUID(), now = new Date().toISOString()): Promise<Anchor> {
  if (!quote.trim()) throw new Error('Select non-whitespace text first.');
  if (quote.length > MAX_QUOTE) throw new Error(`Select at most ${MAX_QUOTE} UTF-16 code units.`);
  if (!Number.isInteger(start) || start < 0 || doc.content.slice(start, start + quote.length) !== quote) throw new Error('Selection differs from the saved source. Save the note and capture again.');
  if (doc.hash !== await hashText(doc.content)) throw new Error('Source snapshot hash is inconsistent.');
  return {
    id: crypto.randomUUID(), sourceId, sourcePath: doc.path, sourceHash: doc.hash,
    quote, quoteHash: await hashText(quote),
    prefix: doc.content.slice(Math.max(0, start - CONTEXT), start),
    suffix: doc.content.slice(start + quote.length, start + quote.length + CONTEXT), start,
    capturedAt: now, validatedAt: now,
    revisions: [{ at: now, path: doc.path, hash: doc.hash, action: 'capture' }]
  };
}
export function exactLocations(text: string, quote: string): number[] {
  if (!quote) return [];
  const result: number[] = [];
  for (let pos = text.indexOf(quote); pos >= 0; pos = text.indexOf(quote, pos + 1)) {
    result.push(pos); if (result.length >= 10001) break;
  }
  return result;
}
function contextMatches(a: Anchor, text: string, start: number): boolean {
  const end = start + a.quote.length;
  return (a.prefix ? text.slice(Math.max(0, start - a.prefix.length), start) === a.prefix : start === 0) &&
    (a.suffix ? text.slice(end, end + a.suffix.length) === a.suffix : end === text.length);
}
function assessKnown(a: Anchor, doc: Snapshot): Assessment {
  const base = { path: doc.path, hash: doc.hash };
  if (doc.hash === a.sourceHash) {
    if (doc.content.slice(a.start, a.start + a.quote.length) === a.quote && contextMatches(a, doc.content, a.start)) {
      return { ...base, status: 'verified', reason: 'Saved source text hash and captured quotation match.', canRevalidate: false, start: a.start };
    }
    return { ...base, status: 'unavailable', reason: 'Stored anchor contradicts its source hash; recapture instead of guessing.', canRevalidate: false };
  }
  const occurrences = exactLocations(doc.content, a.quote);
  const locations = occurrences.filter(p => contextMatches(a, doc.content, p));
  if (occurrences.length > 10000 || locations.length > 1) return { ...base, status: 'ambiguous', reason: 'More than one exact quotation and context candidate remains.', canRevalidate: false };
  if (locations.length === 1) return { ...base, status: 'stale', reason: 'Source changed; the exact quotation and captured context still match. Review the source before revalidation.', canRevalidate: true, start: locations[0] };
  return { ...base, status: 'stale', reason: occurrences.length ? 'Quotation remains, but its captured context changed. Recapture after review.' : 'The exact quotation changed or disappeared. Recapture after review.', canRevalidate: false };
}
export function assess(a: Anchor, docs: Snapshot[], coverage: Coverage = { complete: true }): Assessment {
  if (!supported(a.sourcePath)) return { status: 'unavailable', reason: 'Source was renamed to an unsupported format. PDF and binary anchors are not supported.', canRevalidate: false };
  if (coverage.failedPaths?.includes(a.sourcePath)) return { status: 'unavailable', reason: 'The tracked source could not be read. No replacement source was assumed.', canRevalidate: false };
  const known = docs.find(d => d.path === a.sourcePath);
  if (known) return assessKnown(a, known);
  const identical = docs.filter(d => d.hash === a.sourceHash);
  if (identical.length > 1) return { status: 'ambiguous', reason: 'Stored path is missing and multiple files have the saved source hash. Choose a source explicitly.', canRevalidate: false, candidates: identical.map(d => d.path) };
  if (!coverage.complete) return { status: 'unavailable', reason: 'Scan is partial; missing-path identity cannot be resolved from incomplete coverage.', canRevalidate: false };
  if (identical.length === 1) {
    const result = assessKnown(a, identical[0]);
    if (result.status === 'verified') return { ...result, status: 'stale', canRevalidate: true, reason: 'One unchanged-content source exists at a new path. Confirm this relocation by revalidating.' };
    return result;
  }
  return { status: 'missing', reason: 'Stored path is missing and no unchanged-content match was found. A moved-and-edited file cannot be identified automatically.', canRevalidate: false };
}
export async function revalidate(a: Anchor, observed: Assessment, doc: Snapshot, now = new Date().toISOString()): Promise<Anchor> {
  if (!observed.canRevalidate || !observed.path || observed.path !== doc.path || observed.hash !== doc.hash) throw new Error('Source changed since the check, or this anchor is not safely revalidatable. Check again.');
  if (await hashText(doc.content) !== doc.hash || await hashText(a.quote) !== a.quoteHash) throw new Error('Evidence hash mismatch.');
  const result = assess(a, [doc]);
  if (!result.canRevalidate || result.start === undefined) throw new Error('Exact quotation/context could not be uniquely revalidated.');
  return { ...a, sourcePath: doc.path, sourceHash: doc.hash, start: result.start, validatedAt: now,
    revisions: appendRevision(a.revisions, { at: now, path: doc.path, hash: doc.hash, action: 'revalidate' }) };
}
export async function rebind(a: Anchor, doc: Snapshot, confirmed: boolean, now = new Date().toISOString()): Promise<Anchor> {
  if (!confirmed) throw new Error('Explicit source choice is required.');
  if (await hashText(doc.content) !== doc.hash) throw new Error('Evidence hash mismatch.');
  const locations = exactLocations(doc.content, a.quote).filter(p => contextMatches(a, doc.content, p));
  if (locations.length !== 1) throw new Error('Chosen source must contain one exact quotation/context match. Recapture if its context changed.');
  return { ...a, sourcePath: doc.path, sourceHash: doc.hash, start: locations[0], validatedAt: now,
    revisions: appendRevision(a.revisions, { at: now, path: doc.path, hash: doc.hash, action: 'rebind' }) };
}
export function renameSource(anchors: Anchor[], oldPath: string, newPath: string): Anchor[] {
  return anchors.map(a => a.sourcePath === oldPath || a.sourcePath.startsWith(oldPath + '/')
    ? { ...a, sourcePath: newPath + a.sourcePath.slice(oldPath.length) } : a);
}
export async function parseStore(raw: unknown): Promise<Store> {
  if (raw === null || raw === undefined) return { schema: 1, anchors: [] };
  const value = raw as Partial<Store>;
  if (!value || value.schema !== 1 || !Array.isArray(value.anchors) || value.anchors.length > MAX_ANCHORS) throw new Error('Unsupported or malformed evidence store. Original data was left untouched.');
  const ids = new Set<string>();
  for (const a of value.anchors) {
    if (!a || typeof a.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(a.id) || ids.has(a.id) || typeof a.sourceId !== 'string' || !/^[a-f0-9-]{36}$/i.test(a.sourceId) ||
      !validPath(a.sourcePath) || typeof a.sourceHash !== 'string' || !HASH.test(a.sourceHash) || typeof a.quoteHash !== 'string' || !HASH.test(a.quoteHash) || typeof a.quote !== 'string' || !a.quote.trim() || a.quote.length > MAX_QUOTE ||
      typeof a.prefix !== 'string' || a.prefix.length > CONTEXT || typeof a.suffix !== 'string' || a.suffix.length > CONTEXT || !Number.isInteger(a.start) || a.start < 0 ||
      typeof a.capturedAt !== 'string' || typeof a.validatedAt !== 'string' || !Number.isFinite(Date.parse(a.capturedAt)) || !Number.isFinite(Date.parse(a.validatedAt)) || !Array.isArray(a.revisions) || !a.revisions.length || a.revisions.length > 100) throw new Error('Malformed evidence anchor. Original data was left untouched.');
    if (await hashText(a.quote) !== a.quoteHash) throw new Error('Quotation hash mismatch. Original data was left untouched.');
    for (const r of a.revisions) if (!r || !validPath(r.path) || typeof r.hash !== 'string' || !HASH.test(r.hash) || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at)) || !['capture', 'revalidate', 'rebind'].includes(r.action)) throw new Error('Malformed revision ledger. Original data was left untouched.');
    ids.add(a.id);
  }
  return structuredClone(value) as Store;
}
