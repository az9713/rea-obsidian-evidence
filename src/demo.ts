import { Anchor, Snapshot, assess, capture, renameSource, revalidate, snapshot } from './core';
const initial = '# Synthetic laboratory note\n\n' + 'Background context is retained to distinguish this quotation from a copied sentence. '.repeat(2) + '\nThe measured value is 42 ± 2 units.\n' + 'The apparatus and calibration are documented in the experiment ledger. '.repeat(2);
const quote = 'The measured value is 42 ± 2 units.';
let anchor: Anchor; let docs: Snapshot[] = []; let serial = 0;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
async function reset() { const doc = await snapshot('Sources/experiment.md', initial); docs = [doc]; anchor = await capture(doc, quote, initial.indexOf(quote)); await render(); }
async function render() {
  const token = ++serial; const result = assess(anchor, docs); if (token !== serial) return;
  $('status').textContent = result.status; $('status').className = `status ${result.status}`;
  $('reason').textContent = result.reason;
  $('path').textContent = anchor.sourcePath;
  $('quote').textContent = anchor.quote;
  $('quote-hash').textContent = anchor.quoteHash;
  $('source-hash').textContent = anchor.sourceHash;
  $('current-hash').textContent = result.hash ?? 'No unique candidate';
  $('anchor-id').textContent = anchor.id;
  $('ledger').textContent = JSON.stringify(anchor.revisions, null, 2);
  $('files').textContent = docs.map(d => d.path).join('\n') || '(no source files)';
  const editor = $<HTMLTextAreaElement>('source'); editor.value = docs[0]?.content ?? ''; editor.disabled = docs.length !== 1;
  $<HTMLButtonElement>('revalidate').disabled = !result.canRevalidate;
  for (const id of ['append', 'edit', 'rename', 'duplicates']) $<HTMLButtonElement>(id).disabled = docs.length !== 1;
  $('remove').toggleAttribute('disabled', !docs.length);
}
async function action(callback: () => Promise<void>) { try { await callback(); await render(); } catch (error) { $('reason').textContent = String(error); } }
$('reset').onclick = () => void reset();
$('append').onclick = () => void action(async () => { docs = [await snapshot(docs[0].path, docs[0].content + '\nA later observation: the room temperature was 20 °C.')]; });
$('edit').onclick = () => void action(async () => { docs = [await snapshot(docs[0].path, docs[0].content.replace('42 ± 2', '43 ± 2'))]; });
$('rename').onclick = () => void action(async () => { const old = docs[0].path, path = old.startsWith('Sources') ? 'Research/renamed.md' : 'Sources/experiment.md'; docs = [await snapshot(path, docs[0].content)]; anchor = renameSource([anchor], old, path)[0]; });
$('duplicates').onclick = () => void action(async () => { docs = [await snapshot('Copies/one.md', docs[0].content), await snapshot('Copies/two.md', docs[0].content)]; });
$('remove').onclick = () => void action(async () => { docs = []; });
$('revalidate').onclick = () => void action(async () => { const result = assess(anchor, docs); const doc = docs.find(d => d.path === result.path); if (doc) anchor = await revalidate(anchor, result, doc); });
$('source').onchange = () => void action(async () => { if (docs.length === 1) docs = [await snapshot(docs[0].path, $<HTMLTextAreaElement>('source').value)]; });
void reset();
