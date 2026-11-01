# Source and development attribution

- Official Obsidian API types: `obsidian@1.14.4`, MIT, source inspected at https://github.com/obsidianmd/obsidian-api/tree/9abd9605ce081383674aae1ed111c456edde0688 . Types are development-only; the release expects Obsidian to provide its API at runtime.
- Official sample plugin: 0BSD, https://github.com/obsidianmd/obsidian-sample-plugin/tree/07ceb81d1fb3384af611ebf665a1ec42a7e5926d . Its conventional host-external bundling and lifecycle patterns informed the build. No proprietary application binary or recovered source is included.
- esbuild (MIT), TypeScript (Apache-2.0), Node type declarations (MIT), linkedom (ISC) and Playwright (Apache-2.0): development/test dependencies locked by `package-lock.json`; they are not bundled in the installable plugin.
- PDF++ documentation: https://ryotaushio.github.io/obsidian-pdf-plus/ . Referenced as an existing PDF workflow baseline; no PDF++ code is copied or bundled.

Evidence Anchor's implementation and browser demonstration are MIT licensed. The delivered plugin has no external runtime dependency other than the host's documented `obsidian` API.
