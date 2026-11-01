import { Editor, ItemView, MarkdownView, Modal, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { Anchor, Assessment, Store, Snapshot, assess, capture, parseStore, rebind, renameSource, revalidate, snapshot, supported } from './core';

const VIEW = 'evidence-anchor-panel';
const MAX_FILES = 5000;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

class ConfirmSource extends Modal {
  constructor(private plugin: EvidencePlugin, private anchor: Anchor, private file: TFile) { super(plugin.app); }
  onOpen() {
    this.contentEl.createEl('h2', { text: 'Choose this source explicitly?' });
    this.contentEl.createEl('p', { text: `Reassociate the evidence from “${this.anchor.sourcePath}” to “${this.file.path}”. This is your explicit source choice, not automatic proof that the files have the same origin.` });
    const button = this.contentEl.createEl('button', { text: 'Confirm chosen source', cls: 'mod-cta' });
    button.onclick = async () => { button.disabled = true; await this.plugin.bindToFile(this.anchor.id, this.file); this.close(); };
    this.contentEl.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
  }
  onClose() { this.contentEl.empty(); }
}

export default class EvidencePlugin extends Plugin {
  store: Store = { schema: 1, anchors: [] };
  assessments = new Map<string, Assessment>();
  scanSummary = 'Not checked yet.';
  locked = false;
  busy = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private status!: HTMLElement;
  private saves: Promise<void> = Promise.resolve();
  private generation = 0;
  private disposed = false;
  private sourceReads = new Map<string, Snapshot>();

  async onload() {
    try { this.store = await parseStore(await this.loadData()); }
    catch (error) { this.locked = true; this.scanSummary = String(error); new Notice('Evidence Anchor: stored data could not be validated. Writes are disabled; original data was left untouched.', 12000); }
    this.registerView(VIEW, leaf => new EvidencePanel(leaf, this));
    this.status = this.addStatusBarItem();
    this.status.addClass('evidence-status');
    this.status.onclick = () => void this.openPanel();
    this.addRibbonIcon('quote', 'Open evidence anchors', () => void this.openPanel());
    this.addCommand({ id: 'capture-selection', name: 'Capture selection as evidence', editorCallback: (editor, view) => { void this.captureSelection(editor, view); } });
    this.addCommand({ id: 'open-panel', name: 'Open evidence panel', callback: () => void this.openPanel() });
    this.addCommand({ id: 'check-all', name: 'Check all evidence anchors', callback: () => void this.scan() });
    this.registerObsidianProtocolHandler('evidence-anchor', async params => {
      await this.openPanel();
      const anchor = this.store.anchors.find(a => a.id === params.anchor);
      if (anchor) await this.openSource(anchor.id); else new Notice('Evidence anchor not found in this vault.');
    });
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.locked) return;
      this.store.anchors = renameSource(this.store.anchors, oldPath, file.path);
      this.invalidate(); void this.persist();
    }));
    this.registerEvent(this.app.vault.on('modify', () => this.invalidate()));
    this.registerEvent(this.app.vault.on('create', () => this.invalidate()));
    this.registerEvent(this.app.vault.on('delete', () => this.invalidate()));
    this.register(() => { if (this.timer) clearTimeout(this.timer); this.disposed = true; });
    this.refresh();
    this.app.workspace.onLayoutReady(() => { if (!this.disposed && !this.locked) void this.scan(); });
  }
  onunload() { if (this.timer) clearTimeout(this.timer); this.disposed = true; }
  private invalidate() {
    this.generation++;
    this.sourceReads.clear();
    for (const a of this.store.anchors) this.assessments.set(a.id, { status: 'unavailable', reason: 'Source inventory changed; check pending.', canRevalidate: false });
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.disposed) void this.scan(); }, 600);
    this.refresh();
  }
  async persist() {
    if (this.locked) return;
    const data = structuredClone(this.store);
    this.saves = this.saves.catch(() => undefined).then(() => this.saveData(data));
    try { await this.saves; }
    catch (error) { this.locked = true; this.scanSummary = `Evidence could not be saved: ${String(error)}. Writes disabled until reload.`; new Notice(this.scanSummary, 10000); this.refresh(); }
  }
  private async readSource(file: TFile): Promise<Snapshot> {
    if (!supported(file.path)) throw new Error('Only Markdown and plain-text sources are supported.');
    if (file.stat.size > MAX_FILE_BYTES) throw new Error('Source exceeds the 2 MiB per-file limit.');
    const content = await this.app.vault.read(file);
    if (new TextEncoder().encode(content).byteLength > MAX_FILE_BYTES) throw new Error('Source exceeds the 2 MiB per-file limit.');
    return snapshot(file.path, content);
  }
  async captureSelection(editor: Editor, view: { file: TFile | null }) {
    if (this.locked) return void new Notice('Evidence storage is locked after a validation/save error.');
    if (this.store.anchors.length >= 2000) return void new Notice('Anchor limit reached (2,000). Remove unneeded anchors first.');
    const file = view.file;
    if (!file || !supported(file.path)) return void new Notice('Capture supports saved Markdown and plain text only. PDF anchors are not supported.');
    try {
      const doc = await this.readSource(file);
      if (doc.content !== editor.getValue()) throw new Error('Save the note before capturing. Editor content differs from the source.');
      const quote = editor.getSelection();
      const start = editor.posToOffset(editor.getCursor('from'));
      const sourceId = this.store.anchors.find(a => a.sourcePath === file.path)?.sourceId;
      const anchor = await capture(doc, quote, start, sourceId);
      this.store.anchors.push(anchor); await this.persist(); await this.scan(); await this.openPanel();
      new Notice('Evidence captured. The panel contains its quote and source hashes.');
    } catch (error) { new Notice(String(error), 9000); }
  }
  async scan() {
    if (this.busy || this.locked || this.disposed) return;
    if (!this.store.anchors.length) { this.scanSummary = 'No anchors yet. Source files have not been read.'; this.assessments.clear(); this.refresh(); return; }
    this.busy = true; this.refresh();
    const generation = this.generation;
    try {
      const tracked = new Set(this.store.anchors.map(a => a.sourcePath));
      const files = this.app.vault.getFiles().filter(f => supported(f.path)).sort((a, b) => Number(tracked.has(b.path)) - Number(tracked.has(a.path)) || a.path.localeCompare(b.path));
      const docs: Snapshot[] = []; const failedPaths: string[] = [];
      let total = 0, omitted = 0, attempts = 0;
      for (const file of files) {
        if (attempts >= MAX_FILES || file.stat.size > MAX_FILE_BYTES || total + file.stat.size > MAX_TOTAL_BYTES) { omitted++; failedPaths.push(file.path); continue; }
        try {
          // read(), not cachedRead(): validation must observe current saved content.
          attempts++;
          const content = await this.app.vault.read(file);
          const bytes = new TextEncoder().encode(content).byteLength;
          if (bytes > MAX_FILE_BYTES || total + bytes > MAX_TOTAL_BYTES) { omitted++; failedPaths.push(file.path); continue; }
          docs.push(await snapshot(file.path, content)); total += bytes;
        } catch { omitted++; failedPaths.push(file.path); }
      }
      if (generation !== this.generation || this.disposed) return;
      this.sourceReads = new Map(docs.map(d => [d.path, d]));
      this.assessments = new Map(this.store.anchors.map(a => [a.id, assess(a, docs, { complete: omitted === 0, failedPaths })]));
      this.scanSummary = `${docs.length} text sources checked; ${omitted} unread/skipped. ${omitted ? 'Partial coverage: missing-path resolution withheld.' : 'Complete within Markdown/text scope.'} Source content is not uploaded.`;
    } catch (error) { this.scanSummary = `Check failed: ${String(error)}`; this.assessments.clear(); }
    finally {
      this.busy = false; this.refresh();
      if (generation !== this.generation && !this.disposed) this.timer = setTimeout(() => void this.scan(), 0);
    }
  }
  async verify(id: string) {
    if (this.locked) return;
    const index = this.store.anchors.findIndex(a => a.id === id); const observed = this.assessments.get(id);
    if (index < 0 || !observed?.path) return;
    const file = this.app.vault.getAbstractFileByPath(observed.path);
    if (!(file instanceof TFile)) return void new Notice('Source disappeared. Check again.');
    try {
      const doc = await this.readSource(file);
      this.store.anchors[index] = await revalidate(this.store.anchors[index], observed, doc);
      await this.persist(); await this.scan(); new Notice('Exact quote and context revalidated. Previous source hashes remain in its ledger.');
    } catch (error) { new Notice(String(error), 10000); await this.scan(); }
  }
  async bindToFile(id: string, file: TFile) {
    if (this.locked) return;
    const index = this.store.anchors.findIndex(a => a.id === id);
    if (index < 0) return;
    try {
      const doc = await this.readSource(file);
      this.store.anchors[index] = await rebind(this.store.anchors[index], doc, true);
      await this.persist(); await this.scan(); new Notice('Explicit source choice recorded in the revision ledger.');
    } catch (error) { new Notice(String(error), 10000); }
  }
  chooseActive(id: string) {
    const anchor = this.store.anchors.find(a => a.id === id); const file = this.app.workspace.getActiveFile();
    if (!anchor || !file || !supported(file.path)) return void new Notice('Focus a saved Markdown/plain-text source note first.');
    new ConfirmSource(this, anchor, file).open();
  }
  async remove(id: string) {
    if (this.locked) return;
    this.store.anchors = this.store.anchors.filter(a => a.id !== id);
    this.assessments.delete(id); await this.persist(); this.refresh();
  }
  async copyCitation(a: Anchor) {
    const link = `obsidian://evidence-anchor?vault=${encodeURIComponent(this.app.vault.getName())}&anchor=${encodeURIComponent(a.id)}`;
    try { await navigator.clipboard.writeText(`${a.quote}\n\n${link}\nQuote SHA-256: ${a.quoteHash}\nSource text SHA-256 at validation: ${a.sourceHash}`); new Notice('Evidence citation copied.'); }
    catch { new Notice('Clipboard unavailable. Copy the anchor ID and hashes from the panel.'); }
  }
  async openSource(id: string) {
    const anchor = this.store.anchors.find(a => a.id === id); if (!anchor) return;
    const result = this.assessments.get(id);
    const path = result?.path ?? anchor.sourcePath;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return void new Notice('Source path not found. Check anchors or choose an active source explicitly.');
    await this.app.workspace.getLeaf(false).openFile(file);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const doc = this.sourceReads.get(path);
    if (view && doc && result?.start !== undefined && doc.content === view.editor.getValue()) {
      view.editor.setSelection(view.editor.offsetToPos(result.start), view.editor.offsetToPos(result.start + anchor.quote.length));
    }
  }
  async openPanel() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false)!; if (!leaf) return; await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf); this.refresh();
  }
  refresh() {
    if (this.status) {
      const counts = [...this.assessments.values()];
      const issues = counts.filter(s => s.status !== 'verified').length;
      this.status.setText(this.locked ? 'Evidence: storage locked' : `Evidence: ${this.store.anchors.length} · ${this.busy ? 'checking' : `${issues} need review`}`);
    }
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) if (leaf.view instanceof EvidencePanel) leaf.view.render();
  }
}

class EvidencePanel extends ItemView {
  private filter = 'all';
  constructor(leaf: WorkspaceLeaf, private plugin: EvidencePlugin) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Evidence anchors'; }
  getIcon() { return 'quote'; }
  async onOpen() { this.render(); }
  render() {
    const root = this.contentEl; root.empty(); root.addClass('evidence-panel');
    root.createEl('h2', { text: 'Evidence anchors' });
    root.createEl('p', { text: 'A matching hash proves unchanged saved text, not that a claim is true.', cls: 'evidence-muted' });
    const actions = root.createDiv({ cls: 'evidence-actions' });
    const check = actions.createEl('button', { text: this.plugin.busy ? 'Checking…' : 'Check all', cls: 'mod-cta' });
    check.disabled = this.plugin.busy || this.plugin.locked; check.onclick = () => void this.plugin.scan();
    const select = actions.createEl('select', { attr: { 'aria-label': 'Filter anchor status' } });
    for (const label of ['all', 'verified', 'stale', 'ambiguous', 'missing', 'unavailable']) select.createEl('option', { text: label, value: label });
    select.value = this.filter; select.onchange = () => { this.filter = select.value; this.render(); };
    root.createEl('p', { text: this.plugin.scanSummary, cls: this.plugin.locked ? 'evidence-error' : 'evidence-muted' });
    if (!this.plugin.store.anchors.length) root.createEl('p', { text: 'Select text in a saved Markdown note, then run “Evidence Anchor: Capture selection as evidence”. PDF is deliberately unsupported.' });
    let visible = 0;
    for (const anchor of [...this.plugin.store.anchors].reverse()) {
      const result = this.plugin.assessments.get(anchor.id) ?? { status: 'unavailable', reason: 'Not checked yet.', canRevalidate: false };
      if (this.filter !== 'all' && result.status !== this.filter) continue;
      visible++;
      const card = root.createDiv({ cls: 'evidence-card' });
      card.createSpan({ text: result.status, cls: `evidence-badge is-${result.status}` });
      card.createEl('h3', { text: anchor.sourcePath });
      card.createEl('blockquote', { text: anchor.quote });
      card.createEl('p', { text: result.reason });
      if (result.candidates) card.createEl('p', { text: `Candidates: ${result.candidates.join(' · ')}` });
      card.createEl('p', { text: `Captured ${anchor.capturedAt} · Last validated ${anchor.validatedAt}`, cls: 'evidence-muted' });
      const buttons = card.createDiv({ cls: 'evidence-actions' });
      buttons.createEl('button', { text: 'Open source' }).onclick = () => void this.plugin.openSource(anchor.id);
      buttons.createEl('button', { text: 'Copy citation' }).onclick = () => void this.plugin.copyCitation(anchor);
      const validate = buttons.createEl('button', { text: 'Revalidate exact match' });
      validate.disabled = !result.canRevalidate || this.plugin.locked || this.plugin.busy;
      validate.onclick = () => void this.plugin.verify(anchor.id);
      const bind = buttons.createEl('button', { text: 'Choose active note as source' });
      bind.disabled = this.plugin.locked || this.plugin.busy; bind.onclick = () => this.plugin.chooseActive(anchor.id);
      const details = card.createEl('details'); details.createEl('summary', { text: 'Hashes, identity and revision ledger' });
      details.createEl('pre', { text: JSON.stringify({ anchorId: anchor.id, sourceId: anchor.sourceId, quoteHash: anchor.quoteHash, sourceHash: anchor.sourceHash, revisions: anchor.revisions }, null, 2) });
      const remove = details.createEl('button', { text: 'Remove this anchor' });
      remove.disabled = this.plugin.locked; remove.onclick = () => void this.plugin.remove(anchor.id);
    }
    if (!visible && this.plugin.store.anchors.length) root.createEl('p', { text: 'No anchors match this status filter.' });
  }
}
