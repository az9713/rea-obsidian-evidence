import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { snapshot, capture, assess, revalidate, rebind, renameSource, parseStore, hashText, supported } from '../.test-build/core.mjs';
const quote = 'The measured value is 42.';
const original = `${'a'.repeat(100)}\n${quote}\n${'z'.repeat(100)}`;
async function fixture(text = original, path = 'Sources/experiment.md') {
  const doc = await snapshot(path, text); const start = text.indexOf(quote);
  return { doc, anchor: await capture(doc, quote, start) };
}

test('SHA-256 uses exact UTF-8 text, including Unicode and CRLF', async () => {
  for (const text of ['', 'x\r\ny', 'α ∑ 😀 café', 'e\u0301']) assert.equal(await hashText(text), createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.notEqual(await hashText('é'), await hashText('e\u0301'));
});
test('capture rejects PDF, traversal paths, empty/whitespace and stale selection', async () => {
  assert.equal(supported('S.TXT'), true); assert.equal(supported('S.pdf'), false);
  await assert.rejects(snapshot('Source.pdf', 'claim'), /PDF/);
  await assert.rejects(snapshot('../Source.md', 'claim'), /vault-relative/);
  await assert.rejects(snapshot('C:/Source.md', 'claim'), /vault-relative/);
  const doc = await snapshot('source.md', 'A claim here.');
  await assert.rejects(capture(doc, '  ', 0), /non-whitespace/);
  await assert.rejects(capture(doc, 'claim', 0), /Selection differs/);
  await assert.rejects(capture(doc, 'a'.repeat(8001), 0), /at most/);
});
test('unchanged source and selected quote are verified', async () => {
  const {doc,anchor}=await fixture(); const result=assess(anchor,[doc]);
  assert.equal(result.status,'verified'); assert.equal(result.canRevalidate,false); assert.equal(result.start,101);
});
test('unrelated source change stays stale until an explicit exact-context revalidation', async () => {
  const {anchor}=await fixture(); const changed=await snapshot(anchor.sourcePath,original+' new result');
  const result=assess(anchor,[changed]); assert.equal(result.status,'stale'); assert.equal(result.canRevalidate,true);
  assert.notEqual(anchor.sourceHash,changed.hash); assert.equal(anchor.revisions.length,1);
  const next=await revalidate(anchor,result,changed);
  assert.equal(next.id,anchor.id); assert.equal(next.sourceId,anchor.sourceId); assert.equal(next.revisions.length,2);
  assert.equal(next.revisions[0].hash,anchor.sourceHash); assert.equal(assess(next,[changed]).status,'verified');
});
test('a quote edit is stale and cannot be revalidated', async () => {
  const {anchor}=await fixture(); const changed=await snapshot(anchor.sourcePath,original.replace('42','43'));
  const result=assess(anchor,[changed]); assert.equal(result.status,'stale'); assert.equal(result.canRevalidate,false);
  await assert.rejects(revalidate(anchor,result,changed),/not safely/);
});
test('a context-only edit requires recapture, even if quote is unique', async () => {
  const {anchor}=await fixture(); const changed=await snapshot(anchor.sourcePath,original.slice(0,100)+'!'+original.slice(101));
  const result=assess(anchor,[changed]); assert.equal(result.status,'stale'); assert.equal(result.canRevalidate,false);
});
test('duplicate exact quote/context in changed source is ambiguous', async () => {
  const block='a'.repeat(80)+quote+'z'.repeat(80);
  const {anchor}=await fixture(block); const changed=await snapshot(anchor.sourcePath,block+'\n'+block);
  assert.equal(assess(anchor,[changed]).status,'ambiguous');
});
test('capture offset and context disambiguate repeated quotations', async () => {
  const text='a'.repeat(80)+quote+'b'.repeat(80)+'\n'+'c'.repeat(80)+quote+'d'.repeat(80);
  const doc=await snapshot('source.md',text); const start=text.lastIndexOf(quote); const anchor=await capture(doc,quote,start);
  assert.equal(assess(anchor,[doc]).start,start);
  const changed=await snapshot(doc.path,text+'added'); const result=assess(anchor,[changed]);
  assert.equal(result.start,start); assert.equal(result.canRevalidate,true);
});
test('known file and folder rename preserve IDs and content validation', async () => {
  const {anchor}=await fixture(); const sibling={...anchor,id:crypto.randomUUID(),sourcePath:'Sources-other/a.md'};
  const renamed=renameSource([anchor,sibling],'Sources','Research');
  assert.equal(renamed[0].sourcePath,'Research/experiment.md'); assert.equal(renamed[0].id,anchor.id);
  assert.equal(renamed[1].sourcePath,sibling.sourcePath);
  assert.equal(assess(renamed[0],[await snapshot('Research/experiment.md',original)]).status,'verified');
});
test('missing old path plus one identical file requires explicit relocation confirmation', async () => {
  const {anchor}=await fixture(); const moved=await snapshot('Renamed.md',original); const result=assess(anchor,[moved]);
  assert.equal(result.status,'stale'); assert.equal(result.canRevalidate,true); assert.equal(anchor.sourcePath,'Sources/experiment.md');
  const next=await revalidate(anchor,result,moved); assert.equal(next.sourcePath,'Renamed.md'); assert.equal(next.id,anchor.id);
});
test('deleted original with duplicate copies remains ambiguous; explicit rebind is audited', async () => {
  const {anchor}=await fixture(); const one=await snapshot('Copy1.md',original),two=await snapshot('Copy2.md',original);
  const result=assess(anchor,[one,two]); assert.equal(result.status,'ambiguous'); assert.deepEqual(result.candidates,['Copy1.md','Copy2.md']);
  await assert.rejects(rebind(anchor,one,false),/Explicit/);
  const next=await rebind(anchor,two,true); assert.equal(next.sourcePath,'Copy2.md'); assert.equal(next.revisions.at(-1).action,'rebind');
});
test('known tracked path wins over duplicate copies; no filename-only identity matching', async () => {
  const {anchor,doc}=await fixture(); const copy=await snapshot('Other/experiment.md',original);
  assert.equal(assess(anchor,[doc,copy]).status,'verified');
  const unrelated=await snapshot('Other/experiment.md','unrelated'); assert.equal(assess(anchor,[unrelated]).status,'missing');
});
test('partial scan and failed tracked read withhold identity resolution', async () => {
  const {anchor}=await fixture(); const one=await snapshot('Copy.md',original);
  assert.equal(assess(anchor,[one],{complete:false}).status,'unavailable');
  assert.equal(assess(anchor,[one],{complete:true,failedPaths:[anchor.sourcePath]}).status,'unavailable');
});
test('whitespace and Unicode normalization never silently repair quotation changes', async () => {
  const q='café = α\r\nβ'; const text='start '+q+' end'; const doc=await snapshot('unicode.md',text);const anchor=await capture(doc,q,6);
  for (const changed of [text.replace('\r\n','\n'),text.replace('é','e\u0301'),text.replace(' = ','  = ')]) {
    const result=assess(anchor,[await snapshot(doc.path,changed)]);assert.equal(result.status,'stale');assert.equal(result.canRevalidate,false);
  }
});
test('revalidation refuses a fresh hash different from the reviewed assessment', async () => {
  const {anchor}=await fixture();const changed=await snapshot(anchor.sourcePath,original+'one');const result=assess(anchor,[changed]);
  const changedAgain=await snapshot(anchor.sourcePath,original+'two');
  await assert.rejects(revalidate(anchor,result,changedAgain),/changed since/);
});
test('tampered snapshot and stored quote hashes fail closed', async () => {
  const {anchor,doc}=await fixture();await assert.rejects(capture({...doc,hash:'0'.repeat(64)},quote,101),/inconsistent/);
  await assert.rejects(parseStore({schema:1,anchors:[{...anchor,quote:'Tampered'}]}),/hash mismatch/);
});
test('store validation rejects unknown schema, duplicate IDs, unsafe paths and malformed ledgers', async () => {
  const {anchor}=await fixture();
  for (const value of [{schema:2,anchors:[]},{schema:1,anchors:[anchor,anchor]},{schema:1,anchors:[{...anchor,sourcePath:'../x.md'}]},{schema:1,anchors:[{...anchor,revisions:[{at:'bad'}]}]}]) await assert.rejects(parseStore(value));
  assert.deepEqual(await parseStore(null),{schema:1,anchors:[]}); assert.equal((await parseStore({schema:1,anchors:[anchor]})).anchors.length,1);
});
test('source renamed to unsupported format remains readable metadata but unavailable', async () => {
  const {anchor}=await fixture();const renamed=renameSource([anchor],anchor.sourcePath,'source.pdf')[0];
  assert.equal((await parseStore({schema:1,anchors:[renamed]})).anchors.length,1);assert.equal(assess(renamed,[]).status,'unavailable');
});
test('manual reassociation also refuses ambiguous or changed-context sources', async () => {
  const {anchor}=await fixture();await assert.rejects(rebind(anchor,await snapshot('other.md',original.replace(quote,'no quote')),true),/one exact/);
});
test('unpaired Unicode surrogates are rejected instead of producing replacement-byte collisions', async () => {
  await assert.rejects(hashText('\ud800'),/Ill-formed/);await assert.rejects(snapshot('source.md','x\udfff'),/Ill-formed/);
});
test('bounded revision history retains the original capture plus recent revisions', async () => {
  let {anchor}=await fixture(); const originalHash=anchor.sourceHash;
  for(let i=0;i<105;i++){const doc=await snapshot(anchor.sourcePath,original+String(i));anchor=await revalidate(anchor,assess(anchor,[doc]),doc);}
  assert.equal(anchor.revisions.length,100);assert.equal(anchor.revisions[0].action,'capture');assert.equal(anchor.revisions[0].hash,originalHash);assert.equal(anchor.revisions.at(-1).hash,anchor.sourceHash);
});
