// src/core.ts
var MAX_QUOTE = 8e3;
var CONTEXT = 64;
function supported(path) {
  return /\.(md|txt)$/i.test(path);
}
function validPath(path) {
  return typeof path === "string" && path.length > 0 && path.length <= 4096 && !/[\x00-\x1f\\]/.test(path) && !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split("/").some((p) => p === ".." || p === "." || !p);
}
async function hashText(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 55296 && code <= 56319) {
      const next = text.charCodeAt(++i);
      if (!(next >= 56320 && next <= 57343)) throw new Error("Ill-formed UTF-16 source text cannot be hashed without replacement.");
    } else if (code >= 56320 && code <= 57343) throw new Error("Ill-formed UTF-16 source text cannot be hashed without replacement.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
function appendRevision(revisions, next) {
  return revisions.length < 100 ? [...revisions, next] : [revisions[0], ...revisions.slice(-98), next];
}
async function snapshot(path, content) {
  if (!validPath(path) || !supported(path)) throw new Error("Only vault-relative .md and .txt sources are supported. PDF anchors are not supported.");
  return { path, content, hash: await hashText(content) };
}
async function capture(doc, quote2, start, sourceId = crypto.randomUUID(), now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!quote2.trim()) throw new Error("Select non-whitespace text first.");
  if (quote2.length > MAX_QUOTE) throw new Error(`Select at most ${MAX_QUOTE} UTF-16 code units.`);
  if (!Number.isInteger(start) || start < 0 || doc.content.slice(start, start + quote2.length) !== quote2) throw new Error("Selection differs from the saved source. Save the note and capture again.");
  if (doc.hash !== await hashText(doc.content)) throw new Error("Source snapshot hash is inconsistent.");
  return {
    id: crypto.randomUUID(),
    sourceId,
    sourcePath: doc.path,
    sourceHash: doc.hash,
    quote: quote2,
    quoteHash: await hashText(quote2),
    prefix: doc.content.slice(Math.max(0, start - CONTEXT), start),
    suffix: doc.content.slice(start + quote2.length, start + quote2.length + CONTEXT),
    start,
    capturedAt: now,
    validatedAt: now,
    revisions: [{ at: now, path: doc.path, hash: doc.hash, action: "capture" }]
  };
}
function exactLocations(text, quote2) {
  if (!quote2) return [];
  const result = [];
  for (let pos = text.indexOf(quote2); pos >= 0; pos = text.indexOf(quote2, pos + 1)) {
    result.push(pos);
    if (result.length >= 10001) break;
  }
  return result;
}
function contextMatches(a, text, start) {
  const end = start + a.quote.length;
  return (a.prefix ? text.slice(Math.max(0, start - a.prefix.length), start) === a.prefix : start === 0) && (a.suffix ? text.slice(end, end + a.suffix.length) === a.suffix : end === text.length);
}
function assessKnown(a, doc) {
  const base = { path: doc.path, hash: doc.hash };
  if (doc.hash === a.sourceHash) {
    if (doc.content.slice(a.start, a.start + a.quote.length) === a.quote && contextMatches(a, doc.content, a.start)) {
      return { ...base, status: "verified", reason: "Saved source text hash and captured quotation match.", canRevalidate: false, start: a.start };
    }
    return { ...base, status: "unavailable", reason: "Stored anchor contradicts its source hash; recapture instead of guessing.", canRevalidate: false };
  }
  const occurrences = exactLocations(doc.content, a.quote);
  const locations = occurrences.filter((p) => contextMatches(a, doc.content, p));
  if (occurrences.length > 1e4 || locations.length > 1) return { ...base, status: "ambiguous", reason: "More than one exact quotation and context candidate remains.", canRevalidate: false };
  if (locations.length === 1) return { ...base, status: "stale", reason: "Source changed; the exact quotation and captured context still match. Review the source before revalidation.", canRevalidate: true, start: locations[0] };
  return { ...base, status: "stale", reason: occurrences.length ? "Quotation remains, but its captured context changed. Recapture after review." : "The exact quotation changed or disappeared. Recapture after review.", canRevalidate: false };
}
function assess(a, docs2, coverage = { complete: true }) {
  if (!supported(a.sourcePath)) return { status: "unavailable", reason: "Source was renamed to an unsupported format. PDF and binary anchors are not supported.", canRevalidate: false };
  if (coverage.failedPaths?.includes(a.sourcePath)) return { status: "unavailable", reason: "The tracked source could not be read. No replacement source was assumed.", canRevalidate: false };
  const known = docs2.find((d) => d.path === a.sourcePath);
  if (known) return assessKnown(a, known);
  const identical = docs2.filter((d) => d.hash === a.sourceHash);
  if (identical.length > 1) return { status: "ambiguous", reason: "Stored path is missing and multiple files have the saved source hash. Choose a source explicitly.", canRevalidate: false, candidates: identical.map((d) => d.path) };
  if (!coverage.complete) return { status: "unavailable", reason: "Scan is partial; missing-path identity cannot be resolved from incomplete coverage.", canRevalidate: false };
  if (identical.length === 1) {
    const result = assessKnown(a, identical[0]);
    if (result.status === "verified") return { ...result, status: "stale", canRevalidate: true, reason: "One unchanged-content source exists at a new path. Confirm this relocation by revalidating." };
    return result;
  }
  return { status: "missing", reason: "Stored path is missing and no unchanged-content match was found. A moved-and-edited file cannot be identified automatically.", canRevalidate: false };
}
async function revalidate(a, observed, doc, now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!observed.canRevalidate || !observed.path || observed.path !== doc.path || observed.hash !== doc.hash) throw new Error("Source changed since the check, or this anchor is not safely revalidatable. Check again.");
  if (await hashText(doc.content) !== doc.hash || await hashText(a.quote) !== a.quoteHash) throw new Error("Evidence hash mismatch.");
  const result = assess(a, [doc]);
  if (!result.canRevalidate || result.start === void 0) throw new Error("Exact quotation/context could not be uniquely revalidated.");
  return {
    ...a,
    sourcePath: doc.path,
    sourceHash: doc.hash,
    start: result.start,
    validatedAt: now,
    revisions: appendRevision(a.revisions, { at: now, path: doc.path, hash: doc.hash, action: "revalidate" })
  };
}
function renameSource(anchors, oldPath, newPath) {
  return anchors.map((a) => a.sourcePath === oldPath || a.sourcePath.startsWith(oldPath + "/") ? { ...a, sourcePath: newPath + a.sourcePath.slice(oldPath.length) } : a);
}

// src/demo.ts
var initial = "# Synthetic laboratory note\n\n" + "Background context is retained to distinguish this quotation from a copied sentence. ".repeat(2) + "\nThe measured value is 42 \xB1 2 units.\n" + "The apparatus and calibration are documented in the experiment ledger. ".repeat(2);
var quote = "The measured value is 42 \xB1 2 units.";
var anchor;
var docs = [];
var serial = 0;
var $ = (id) => document.getElementById(id);
async function reset() {
  const doc = await snapshot("Sources/experiment.md", initial);
  docs = [doc];
  anchor = await capture(doc, quote, initial.indexOf(quote));
  await render();
}
async function render() {
  const token = ++serial;
  const result = assess(anchor, docs);
  if (token !== serial) return;
  $("status").textContent = result.status;
  $("status").className = `status ${result.status}`;
  $("reason").textContent = result.reason;
  $("path").textContent = anchor.sourcePath;
  $("quote").textContent = anchor.quote;
  $("quote-hash").textContent = anchor.quoteHash;
  $("source-hash").textContent = anchor.sourceHash;
  $("current-hash").textContent = result.hash ?? "No unique candidate";
  $("anchor-id").textContent = anchor.id;
  $("ledger").textContent = JSON.stringify(anchor.revisions, null, 2);
  $("files").textContent = docs.map((d) => d.path).join("\n") || "(no source files)";
  const editor = $("source");
  editor.value = docs[0]?.content ?? "";
  editor.disabled = docs.length !== 1;
  $("revalidate").disabled = !result.canRevalidate;
  for (const id of ["append", "edit", "rename", "duplicates"]) $(id).disabled = docs.length !== 1;
  $("remove").toggleAttribute("disabled", !docs.length);
}
async function action(callback) {
  try {
    await callback();
    await render();
  } catch (error) {
    $("reason").textContent = String(error);
  }
}
$("reset").onclick = () => void reset();
$("append").onclick = () => void action(async () => {
  docs = [await snapshot(docs[0].path, docs[0].content + "\nA later observation: the room temperature was 20 \xB0C.")];
});
$("edit").onclick = () => void action(async () => {
  docs = [await snapshot(docs[0].path, docs[0].content.replace("42 \xB1 2", "43 \xB1 2"))];
});
$("rename").onclick = () => void action(async () => {
  const old = docs[0].path, path = old.startsWith("Sources") ? "Research/renamed.md" : "Sources/experiment.md";
  docs = [await snapshot(path, docs[0].content)];
  anchor = renameSource([anchor], old, path)[0];
});
$("duplicates").onclick = () => void action(async () => {
  docs = [await snapshot("Copies/one.md", docs[0].content), await snapshot("Copies/two.md", docs[0].content)];
});
$("remove").onclick = () => void action(async () => {
  docs = [];
});
$("revalidate").onclick = () => void action(async () => {
  const result = assess(anchor, docs);
  const doc = docs.find((d) => d.path === result.path);
  if (doc) anchor = await revalidate(anchor, result, doc);
});
$("source").onchange = () => void action(async () => {
  if (docs.length === 1) docs = [await snapshot(docs[0].path, $("source").value)];
});
void reset();
