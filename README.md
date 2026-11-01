# Evidence Anchor for Obsidian

**Capture a passage, notice source drift, and explicitly revalidate an exact quotation.**

[Live interactive showcase](https://az9713.github.io/rea-obsidian-evidence/) · [Download plugin and synthetic demo vault](https://github.com/az9713/rea-obsidian-evidence/releases/latest)

![Interactive core demo, not an Obsidian screenshot](https://az9713.github.io/rea-obsidian-evidence/demo-desktop.png)

## Feature showcase

- SHA-256 fingerprints of the captured quotation and saved source text.
- Stable anchor and logical-source IDs; tracked file/folder renames preserve anchor identity.
- Visible verified, stale, ambiguous, missing and unavailable states in a right-side panel and status bar.
- Exact-context checks distinguish repeated quotations; missing sources are never identified by filename alone.
- Explicit revalidation after source edits, a fresh-read race check, and an audited source-choice action for ambiguous copies.
- A bounded revision ledger retains the original capture plus the latest 99 changes; copyable citations contain an Obsidian deep link and hashes.
- No source-note edits or plugin network requests. Invalid persisted metadata disables writes instead of discarding the original.

This is a **documented public-API extension**, not a REA-recovered modification of Obsidian. Native links/block references already navigate notes; PDF++ already supplies sophisticated PDF workflows. This project adds a narrowly defined text-identity/revalidation contract. It does not claim PDF++ parity or that a hash proves a claim scientifically correct.

## Install the release

1. Unzip `evidence-anchor-0.1.0.zip` into a **test vault's** `.obsidian/plugins/` folder. The result must be `.obsidian/plugins/evidence-anchor/main.js`, `manifest.json`, and `styles.css`.
2. Reload Obsidian and enable the plugin in Settings → Community plugins.
3. Select text in a saved Markdown note and run **Evidence Anchor: Capture selection as evidence**.
4. Open the evidence panel from its command, ribbon icon or status bar. Review source changes before choosing **Revalidate exact match**.

The separate demo-vault ZIP contains only synthetic notes and one preloaded anchor. Open that folder as a test vault and enable community plugins. No npm installation is required to use either ZIP.

## Behavior and limits

Only Markdown/plain text (`.md`, `.txt`) sources are supported. The capture command needs a host editor surface; a `.txt` file without an editor is not captureable through that command. **PDF, OCR, image, URL and page-coordinate anchoring are unsupported.**

Any source-text hash change makes an anchor stale. Revalidation requires a unique exact quotation plus its captured prefix/suffix. If the quotation or nearby context changes, review and recapture. Whitespace, CRLF and Unicode normalization are intentionally not ignored. A tracked rename preserves identity; an unobserved move with exactly one identical source requires explicit relocation confirmation. Several identical copies remain ambiguous. “Choose active note as source” records the user's explicit reassociation; it does not prove historical authorship.

Hashes cover the UTF-8 encoding of the decoded text delivered by Obsidian's API, **not raw on-disk file encodings**. They are local integrity fingerprints, not digital signatures. A check is a sequential observation, not an atomic filesystem snapshot. A known tracked path remains authoritative over copies; replacing that file is a source change that requires human review.

Limits: 2,000 anchors, 8,000 UTF-16 code units per quotation, 2 MiB per source file, 5,000 text files/32 MiB per scan, original capture plus latest 99 ledger revisions. A partial/unreadable scan reports unavailable states instead of claiming a unique missing-path resolution. Metadata/quotes are stored in the vault's plugin `data.json`; vault sync software can synchronize them even though this plugin makes no network requests.

## Build and verification

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run release
```

Node.js 22+, npm and the locked development dependencies are sufficient. Build generates a dependency-free CommonJS plugin (`obsidian` remains the host external), plus the browser demo. Release builds/tests, creates the synthetic vault, packages both ZIPs and writes SHA-256 checksums.

Automated tests exercise stale/revalidation behavior, duplicate/context resolution, file/folder renames, deletion, whitespace/Unicode, changed-after-check races, malformed persisted data and unsafe rendering. Compiled-plugin integration uses **explicit public-API mocks and linkedom**, not the real Obsidian desktop app. See [verification.json](https://az9713.github.io/rea-obsidian-evidence/verification.json) and [test TAP output](https://github.com/az9713/rea-obsidian-evidence/blob/main/tests/test-results.tap).

`npm run test:browser` exercises the interactive demo in Chromium. Set `BROWSER_EXECUTABLE_PATH` to your browser executable (or install the Playwright browser first). It uses a project-local `.test-build` profile and writes screenshots and `docs/browser-verification.json`. This verifies the browser demonstration, not Obsidian. `python scripts/verify_release.py` independently checks ZIP CRCs, path safety, checksums and packaged-plugin equality.

**Real-host status:** an isolated Obsidian host has not been verified. No installed app or private vault was accessed. A portable vendor host was not launched because writes outside the allowed workspace could not be independently excluded. This is an installable release candidate, not a claim of complete desktop integration or validated compatibility with every Obsidian version. The declared minimum version is 1.5.0; real-host compatibility remains to be checked.

## Baseline and sources

The official Obsidian API is pinned at commit [`9abd9605ce081383674aae1ed111c456edde0688`](https://github.com/obsidianmd/obsidian-api/tree/9abd9605ce081383674aae1ed111c456edde0688); npm type definitions are locked to `obsidian@1.14.4`. Official sample patterns were checked at [`07ceb81d1fb3384af611ebf665a1ec42a7e5926d`](https://github.com/obsidianmd/obsidian-sample-plugin/tree/07ceb81d1fb3384af611ebf665a1ec42a7e5926d). [PDF++](https://ryotaushio.github.io/obsidian-pdf-plus/) is the existing PDF baseline; its functionality is not reproduced here. This code was implemented independently using the documented extension surface.

MIT license. See [third-party notices](THIRD_PARTY_NOTICES.md). No real vault contents or private machine inventory belong in this repository.
