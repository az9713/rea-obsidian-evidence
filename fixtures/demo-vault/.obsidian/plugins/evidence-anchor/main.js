/* Evidence Anchor 0.1.0 · MIT · Public Obsidian API extension */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => EvidencePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// src/core.ts
var HASH = /^[a-f0-9]{64}$/;
var MAX_ANCHORS = 2e3;
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
async function capture(doc, quote, start, sourceId = crypto.randomUUID(), now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!quote.trim()) throw new Error("Select non-whitespace text first.");
  if (quote.length > MAX_QUOTE) throw new Error(`Select at most ${MAX_QUOTE} UTF-16 code units.`);
  if (!Number.isInteger(start) || start < 0 || doc.content.slice(start, start + quote.length) !== quote) throw new Error("Selection differs from the saved source. Save the note and capture again.");
  if (doc.hash !== await hashText(doc.content)) throw new Error("Source snapshot hash is inconsistent.");
  return {
    id: crypto.randomUUID(),
    sourceId,
    sourcePath: doc.path,
    sourceHash: doc.hash,
    quote,
    quoteHash: await hashText(quote),
    prefix: doc.content.slice(Math.max(0, start - CONTEXT), start),
    suffix: doc.content.slice(start + quote.length, start + quote.length + CONTEXT),
    start,
    capturedAt: now,
    validatedAt: now,
    revisions: [{ at: now, path: doc.path, hash: doc.hash, action: "capture" }]
  };
}
function exactLocations(text, quote) {
  if (!quote) return [];
  const result = [];
  for (let pos = text.indexOf(quote); pos >= 0; pos = text.indexOf(quote, pos + 1)) {
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
function assess(a, docs, coverage = { complete: true }) {
  if (!supported(a.sourcePath)) return { status: "unavailable", reason: "Source was renamed to an unsupported format. PDF and binary anchors are not supported.", canRevalidate: false };
  if (coverage.failedPaths?.includes(a.sourcePath)) return { status: "unavailable", reason: "The tracked source could not be read. No replacement source was assumed.", canRevalidate: false };
  const known = docs.find((d) => d.path === a.sourcePath);
  if (known) return assessKnown(a, known);
  const identical = docs.filter((d) => d.hash === a.sourceHash);
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
async function rebind(a, doc, confirmed, now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!confirmed) throw new Error("Explicit source choice is required.");
  if (await hashText(doc.content) !== doc.hash) throw new Error("Evidence hash mismatch.");
  const locations = exactLocations(doc.content, a.quote).filter((p) => contextMatches(a, doc.content, p));
  if (locations.length !== 1) throw new Error("Chosen source must contain one exact quotation/context match. Recapture if its context changed.");
  return {
    ...a,
    sourcePath: doc.path,
    sourceHash: doc.hash,
    start: locations[0],
    validatedAt: now,
    revisions: appendRevision(a.revisions, { at: now, path: doc.path, hash: doc.hash, action: "rebind" })
  };
}
function renameSource(anchors, oldPath, newPath) {
  return anchors.map((a) => a.sourcePath === oldPath || a.sourcePath.startsWith(oldPath + "/") ? { ...a, sourcePath: newPath + a.sourcePath.slice(oldPath.length) } : a);
}
async function parseStore(raw) {
  if (raw === null || raw === void 0) return { schema: 1, anchors: [] };
  const value = raw;
  if (!value || value.schema !== 1 || !Array.isArray(value.anchors) || value.anchors.length > MAX_ANCHORS) throw new Error("Unsupported or malformed evidence store. Original data was left untouched.");
  const ids = /* @__PURE__ */ new Set();
  for (const a of value.anchors) {
    if (!a || typeof a.id !== "string" || !/^[a-f0-9-]{36}$/i.test(a.id) || ids.has(a.id) || typeof a.sourceId !== "string" || !/^[a-f0-9-]{36}$/i.test(a.sourceId) || !validPath(a.sourcePath) || typeof a.sourceHash !== "string" || !HASH.test(a.sourceHash) || typeof a.quoteHash !== "string" || !HASH.test(a.quoteHash) || typeof a.quote !== "string" || !a.quote.trim() || a.quote.length > MAX_QUOTE || typeof a.prefix !== "string" || a.prefix.length > CONTEXT || typeof a.suffix !== "string" || a.suffix.length > CONTEXT || !Number.isInteger(a.start) || a.start < 0 || typeof a.capturedAt !== "string" || typeof a.validatedAt !== "string" || !Number.isFinite(Date.parse(a.capturedAt)) || !Number.isFinite(Date.parse(a.validatedAt)) || !Array.isArray(a.revisions) || !a.revisions.length || a.revisions.length > 100) throw new Error("Malformed evidence anchor. Original data was left untouched.");
    if (await hashText(a.quote) !== a.quoteHash) throw new Error("Quotation hash mismatch. Original data was left untouched.");
    for (const r of a.revisions) if (!r || !validPath(r.path) || typeof r.hash !== "string" || !HASH.test(r.hash) || typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at)) || !["capture", "revalidate", "rebind"].includes(r.action)) throw new Error("Malformed revision ledger. Original data was left untouched.");
    ids.add(a.id);
  }
  return structuredClone(value);
}

// src/main.ts
var VIEW = "evidence-anchor-panel";
var MAX_FILES = 5e3;
var MAX_TOTAL_BYTES = 32 * 1024 * 1024;
var MAX_FILE_BYTES = 2 * 1024 * 1024;
var ConfirmSource = class extends import_obsidian.Modal {
  constructor(plugin, anchor, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.anchor = anchor;
    this.file = file;
  }
  plugin;
  anchor;
  file;
  onOpen() {
    this.contentEl.createEl("h2", { text: "Choose this source explicitly?" });
    this.contentEl.createEl("p", { text: `Reassociate the evidence from \u201C${this.anchor.sourcePath}\u201D to \u201C${this.file.path}\u201D. This is your explicit source choice, not automatic proof that the files have the same origin.` });
    const button = this.contentEl.createEl("button", { text: "Confirm chosen source", cls: "mod-cta" });
    button.onclick = async () => {
      button.disabled = true;
      await this.plugin.bindToFile(this.anchor.id, this.file);
      this.close();
    };
    this.contentEl.createEl("button", { text: "Cancel" }).onclick = () => this.close();
  }
  onClose() {
    this.contentEl.empty();
  }
};
var EvidencePlugin = class extends import_obsidian.Plugin {
  store = { schema: 1, anchors: [] };
  assessments = /* @__PURE__ */ new Map();
  scanSummary = "Not checked yet.";
  locked = false;
  busy = false;
  timer;
  status;
  saves = Promise.resolve();
  generation = 0;
  disposed = false;
  sourceReads = /* @__PURE__ */ new Map();
  async onload() {
    try {
      this.store = await parseStore(await this.loadData());
    } catch (error) {
      this.locked = true;
      this.scanSummary = String(error);
      new import_obsidian.Notice("Evidence Anchor: stored data could not be validated. Writes are disabled; original data was left untouched.", 12e3);
    }
    this.registerView(VIEW, (leaf) => new EvidencePanel(leaf, this));
    this.status = this.addStatusBarItem();
    this.status.addClass("evidence-status");
    this.status.onclick = () => void this.openPanel();
    this.addRibbonIcon("quote", "Open evidence anchors", () => void this.openPanel());
    this.addCommand({ id: "capture-selection", name: "Capture selection as evidence", editorCallback: (editor, view) => {
      void this.captureSelection(editor, view);
    } });
    this.addCommand({ id: "open-panel", name: "Open evidence panel", callback: () => void this.openPanel() });
    this.addCommand({ id: "check-all", name: "Check all evidence anchors", callback: () => void this.scan() });
    this.registerObsidianProtocolHandler("evidence-anchor", async (params) => {
      await this.openPanel();
      const anchor = this.store.anchors.find((a) => a.id === params.anchor);
      if (anchor) await this.openSource(anchor.id);
      else new import_obsidian.Notice("Evidence anchor not found in this vault.");
    });
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (this.locked) return;
      this.store.anchors = renameSource(this.store.anchors, oldPath, file.path);
      this.invalidate();
      void this.persist();
    }));
    this.registerEvent(this.app.vault.on("modify", () => this.invalidate()));
    this.registerEvent(this.app.vault.on("create", () => this.invalidate()));
    this.registerEvent(this.app.vault.on("delete", () => this.invalidate()));
    this.register(() => {
      if (this.timer) clearTimeout(this.timer);
      this.disposed = true;
    });
    this.refresh();
    this.app.workspace.onLayoutReady(() => {
      if (!this.disposed && !this.locked) void this.scan();
    });
  }
  onunload() {
    if (this.timer) clearTimeout(this.timer);
    this.disposed = true;
  }
  invalidate() {
    this.generation++;
    this.sourceReads.clear();
    for (const a of this.store.anchors) this.assessments.set(a.id, { status: "unavailable", reason: "Source inventory changed; check pending.", canRevalidate: false });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.disposed) void this.scan();
    }, 600);
    this.refresh();
  }
  async persist() {
    if (this.locked) return;
    const data = structuredClone(this.store);
    this.saves = this.saves.catch(() => void 0).then(() => this.saveData(data));
    try {
      await this.saves;
    } catch (error) {
      this.locked = true;
      this.scanSummary = `Evidence could not be saved: ${String(error)}. Writes disabled until reload.`;
      new import_obsidian.Notice(this.scanSummary, 1e4);
      this.refresh();
    }
  }
  async readSource(file) {
    if (!supported(file.path)) throw new Error("Only Markdown and plain-text sources are supported.");
    if (file.stat.size > MAX_FILE_BYTES) throw new Error("Source exceeds the 2 MiB per-file limit.");
    const content = await this.app.vault.read(file);
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new Error("Source exceeds the 2 MiB per-file limit.");
    return snapshot(file.path, content);
  }
  async captureSelection(editor, view) {
    if (this.locked) return void new import_obsidian.Notice("Evidence storage is locked after a validation/save error.");
    if (this.store.anchors.length >= 2e3) return void new import_obsidian.Notice("Anchor limit reached (2,000). Remove unneeded anchors first.");
    const file = view.file;
    if (!file || !supported(file.path)) return void new import_obsidian.Notice("Capture supports saved Markdown and plain text only. PDF anchors are not supported.");
    try {
      const doc = await this.readSource(file);
      if (doc.content !== editor.getValue()) throw new Error("Save the note before capturing. Editor content differs from the source.");
      const quote = editor.getSelection();
      const start = editor.posToOffset(editor.getCursor("from"));
      const sourceId = this.store.anchors.find((a) => a.sourcePath === file.path)?.sourceId;
      const anchor = await capture(doc, quote, start, sourceId);
      this.store.anchors.push(anchor);
      await this.persist();
      await this.scan();
      await this.openPanel();
      new import_obsidian.Notice("Evidence captured. The panel contains its quote and source hashes.");
    } catch (error) {
      new import_obsidian.Notice(String(error), 9e3);
    }
  }
  async scan() {
    if (this.busy || this.locked || this.disposed) return;
    if (!this.store.anchors.length) {
      this.scanSummary = "No anchors yet. Source files have not been read.";
      this.assessments.clear();
      this.refresh();
      return;
    }
    this.busy = true;
    this.refresh();
    const generation = this.generation;
    try {
      const tracked = new Set(this.store.anchors.map((a) => a.sourcePath));
      const files = this.app.vault.getFiles().filter((f) => supported(f.path)).sort((a, b) => Number(tracked.has(b.path)) - Number(tracked.has(a.path)) || a.path.localeCompare(b.path));
      const docs = [];
      const failedPaths = [];
      let total = 0, omitted = 0, attempts = 0;
      for (const file of files) {
        if (attempts >= MAX_FILES || file.stat.size > MAX_FILE_BYTES || total + file.stat.size > MAX_TOTAL_BYTES) {
          omitted++;
          failedPaths.push(file.path);
          continue;
        }
        try {
          attempts++;
          const content = await this.app.vault.read(file);
          const bytes = new TextEncoder().encode(content).byteLength;
          if (bytes > MAX_FILE_BYTES || total + bytes > MAX_TOTAL_BYTES) {
            omitted++;
            failedPaths.push(file.path);
            continue;
          }
          docs.push(await snapshot(file.path, content));
          total += bytes;
        } catch {
          omitted++;
          failedPaths.push(file.path);
        }
      }
      if (generation !== this.generation || this.disposed) return;
      this.sourceReads = new Map(docs.map((d) => [d.path, d]));
      this.assessments = new Map(this.store.anchors.map((a) => [a.id, assess(a, docs, { complete: omitted === 0, failedPaths })]));
      this.scanSummary = `${docs.length} text sources checked; ${omitted} unread/skipped. ${omitted ? "Partial coverage: missing-path resolution withheld." : "Complete within Markdown/text scope."} Source content is not uploaded.`;
    } catch (error) {
      this.scanSummary = `Check failed: ${String(error)}`;
      this.assessments.clear();
    } finally {
      this.busy = false;
      this.refresh();
      if (generation !== this.generation && !this.disposed) this.timer = setTimeout(() => void this.scan(), 0);
    }
  }
  async verify(id) {
    if (this.locked) return;
    const index = this.store.anchors.findIndex((a) => a.id === id);
    const observed = this.assessments.get(id);
    if (index < 0 || !observed?.path) return;
    const file = this.app.vault.getAbstractFileByPath(observed.path);
    if (!(file instanceof import_obsidian.TFile)) return void new import_obsidian.Notice("Source disappeared. Check again.");
    try {
      const doc = await this.readSource(file);
      this.store.anchors[index] = await revalidate(this.store.anchors[index], observed, doc);
      await this.persist();
      await this.scan();
      new import_obsidian.Notice("Exact quote and context revalidated. Previous source hashes remain in its ledger.");
    } catch (error) {
      new import_obsidian.Notice(String(error), 1e4);
      await this.scan();
    }
  }
  async bindToFile(id, file) {
    if (this.locked) return;
    const index = this.store.anchors.findIndex((a) => a.id === id);
    if (index < 0) return;
    try {
      const doc = await this.readSource(file);
      this.store.anchors[index] = await rebind(this.store.anchors[index], doc, true);
      await this.persist();
      await this.scan();
      new import_obsidian.Notice("Explicit source choice recorded in the revision ledger.");
    } catch (error) {
      new import_obsidian.Notice(String(error), 1e4);
    }
  }
  chooseActive(id) {
    const anchor = this.store.anchors.find((a) => a.id === id);
    const file = this.app.workspace.getActiveFile();
    if (!anchor || !file || !supported(file.path)) return void new import_obsidian.Notice("Focus a saved Markdown/plain-text source note first.");
    new ConfirmSource(this, anchor, file).open();
  }
  async remove(id) {
    if (this.locked) return;
    this.store.anchors = this.store.anchors.filter((a) => a.id !== id);
    this.assessments.delete(id);
    await this.persist();
    this.refresh();
  }
  async copyCitation(a) {
    const link = `obsidian://evidence-anchor?vault=${encodeURIComponent(this.app.vault.getName())}&anchor=${encodeURIComponent(a.id)}`;
    try {
      await navigator.clipboard.writeText(`${a.quote}

${link}
Quote SHA-256: ${a.quoteHash}
Source text SHA-256 at validation: ${a.sourceHash}`);
      new import_obsidian.Notice("Evidence citation copied.");
    } catch {
      new import_obsidian.Notice("Clipboard unavailable. Copy the anchor ID and hashes from the panel.");
    }
  }
  async openSource(id) {
    const anchor = this.store.anchors.find((a) => a.id === id);
    if (!anchor) return;
    const result = this.assessments.get(id);
    const path = result?.path ?? anchor.sourcePath;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian.TFile)) return void new import_obsidian.Notice("Source path not found. Check anchors or choose an active source explicitly.");
    await this.app.workspace.getLeaf(false).openFile(file);
    const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    const doc = this.sourceReads.get(path);
    if (view && doc && result?.start !== void 0 && doc.content === view.editor.getValue()) {
      view.editor.setSelection(view.editor.offsetToPos(result.start), view.editor.offsetToPos(result.start + anchor.quote.length));
    }
  }
  async openPanel() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    this.refresh();
  }
  refresh() {
    if (this.status) {
      const counts = [...this.assessments.values()];
      const issues = counts.filter((s) => s.status !== "verified").length;
      this.status.setText(this.locked ? "Evidence: storage locked" : `Evidence: ${this.store.anchors.length} \xB7 ${this.busy ? "checking" : `${issues} need review`}`);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof EvidencePanel) leaf.view.render();
  }
};
var EvidencePanel = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  plugin;
  filter = "all";
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "Evidence anchors";
  }
  getIcon() {
    return "quote";
  }
  async onOpen() {
    this.render();
  }
  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("evidence-panel");
    root.createEl("h2", { text: "Evidence anchors" });
    root.createEl("p", { text: "A matching hash proves unchanged saved text, not that a claim is true.", cls: "evidence-muted" });
    const actions = root.createDiv({ cls: "evidence-actions" });
    const check = actions.createEl("button", { text: this.plugin.busy ? "Checking\u2026" : "Check all", cls: "mod-cta" });
    check.disabled = this.plugin.busy || this.plugin.locked;
    check.onclick = () => void this.plugin.scan();
    const select = actions.createEl("select", { attr: { "aria-label": "Filter anchor status" } });
    for (const label of ["all", "verified", "stale", "ambiguous", "missing", "unavailable"]) select.createEl("option", { text: label, value: label });
    select.value = this.filter;
    select.onchange = () => {
      this.filter = select.value;
      this.render();
    };
    root.createEl("p", { text: this.plugin.scanSummary, cls: this.plugin.locked ? "evidence-error" : "evidence-muted" });
    if (!this.plugin.store.anchors.length) root.createEl("p", { text: "Select text in a saved Markdown note, then run \u201CEvidence Anchor: Capture selection as evidence\u201D. PDF is deliberately unsupported." });
    let visible = 0;
    for (const anchor of [...this.plugin.store.anchors].reverse()) {
      const result = this.plugin.assessments.get(anchor.id) ?? { status: "unavailable", reason: "Not checked yet.", canRevalidate: false };
      if (this.filter !== "all" && result.status !== this.filter) continue;
      visible++;
      const card = root.createDiv({ cls: "evidence-card" });
      card.createSpan({ text: result.status, cls: `evidence-badge is-${result.status}` });
      card.createEl("h3", { text: anchor.sourcePath });
      card.createEl("blockquote", { text: anchor.quote });
      card.createEl("p", { text: result.reason });
      if (result.candidates) card.createEl("p", { text: `Candidates: ${result.candidates.join(" \xB7 ")}` });
      card.createEl("p", { text: `Captured ${anchor.capturedAt} \xB7 Last validated ${anchor.validatedAt}`, cls: "evidence-muted" });
      const buttons = card.createDiv({ cls: "evidence-actions" });
      buttons.createEl("button", { text: "Open source" }).onclick = () => void this.plugin.openSource(anchor.id);
      buttons.createEl("button", { text: "Copy citation" }).onclick = () => void this.plugin.copyCitation(anchor);
      const validate = buttons.createEl("button", { text: "Revalidate exact match" });
      validate.disabled = !result.canRevalidate || this.plugin.locked || this.plugin.busy;
      validate.onclick = () => void this.plugin.verify(anchor.id);
      const bind = buttons.createEl("button", { text: "Choose active note as source" });
      bind.disabled = this.plugin.locked || this.plugin.busy;
      bind.onclick = () => this.plugin.chooseActive(anchor.id);
      const details = card.createEl("details");
      details.createEl("summary", { text: "Hashes, identity and revision ledger" });
      details.createEl("pre", { text: JSON.stringify({ anchorId: anchor.id, sourceId: anchor.sourceId, quoteHash: anchor.quoteHash, sourceHash: anchor.sourceHash, revisions: anchor.revisions }, null, 2) });
      const remove = details.createEl("button", { text: "Remove this anchor" });
      remove.disabled = this.plugin.locked;
      remove.onclick = () => void this.plugin.remove(anchor.id);
    }
    if (!visible && this.plugin.store.anchors.length) root.createEl("p", { text: "No anchors match this status filter." });
  }
};
