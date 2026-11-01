# Evidence Anchor synthetic demo

This vault contains invented text only. Enable community plugins for this test vault and enable **Evidence Anchor**.

1. Open the evidence panel from the ribbon or command palette. The preloaded quote is verified.
2. Open [[Sources/Experiment]]. Append a sentence after all existing text, save and check. Its anchor becomes stale; explicit revalidation is available.
3. Change the quoted 42 to 43, save and check. Exact revalidation is refused. Undo the edit in Obsidian or recapture reviewed text.
4. Rename the source inside Obsidian. The anchor ID stays stable.
5. Make two exact copies, delete the original and check. Missing-path recovery is ambiguous. Focus the intended copy and choose it explicitly from the panel.

Quotes and metadata are saved under this vault's plugin data directory. The plugin never edits source notes. PDFs are unsupported. This package is an installable candidate; automated tests use API mocks, not a real Obsidian host.
