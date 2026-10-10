# Offline finished-sheet demo files

Run from the public worktree with the existing runtime:

```powershell
pnpm.cmd exec tsx demo/fixtures/generate.mjs
```

Outputs live outside Git in
`C:\Users\mhmmd\.codex\demo-artwork\auto-gang-sheet-public`:

- `ready-sheet-22.3x78-100dpi.png`: 2230×7800px, fits the explicit22.5-inch press; variant length80 covers it.
- `overflow-sheet-23.91x80-100dpi.png`: 2391×8000px, genuinely too wide; must be rejected with the measured width and22.5-inch limit, never priced.

Both are valid RGBA PNGs with a transparent full page, real compressed pixels,
CRC checksums and100DPI pHYs metadata. Original geometric test marks have fixed
positions authored in the generator; this is a prepared customer file, not an
app layout/nesting feature. No real customer artwork or AI product photograph
is used. The intentionally100DPI files prove sizing/fit, not print quality;
existing low-DPI warnings are expected and must not be hidden.

pHYs uses integer pixels/metre, so100DPI becomes99.9998DPI. The app parser therefore
reads approximately22.300045×78.000156 and23.910048×80.000160 inches. This tiny
representation error is within the explicit0.02-inch export tolerance; it cannot
explain away the overflowing23.91-inch width.

The generator reads its files back through the existing app header parser and
fit validator, prints hashes/dimensions, and refuses to overwrite different
existing bytes. Re-running with identical bytes is safe. It performs no browser,
API, database, storage or queue operation. These files are synthetic fixtures,
not evidence that an upload, preview, checkout or payment has actually run.

Executed offline verification,10October2026: existing parser/fit assertions passed
for both files. Windows System.Drawing/GDI+ independently decoded both as
Format32bppArgb at99.999794DPI; an opaque teal mark and transparent first/last
pixels matched. Files are83,565 and90,239bytes, respectively. SHA-256:

```text
ready:    808b45166c0e7b917e5ce4603d25a36ded08a6506d20567c498bfd3a7c277473
overflow: c561920cd8f665e3747a91d2c878d0100386b12cd86ea070d258622a9c4fad4c
```
