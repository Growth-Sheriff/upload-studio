import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// One-off review-store artwork, never storefront tracking or runtime AI.
const output = fileURLToPath(new URL('./assets/', import.meta.url));
const journalPath = path.join(output, 'generation.json');
const model = 'fal-ai/nano-banana-2';
const key = process.env.FAL_KEY;
if (!key) throw new Error('Set FAL_KEY outside the repository.');
const common = 'Premium editorial product photograph for an explicitly labeled demo DTF transfer shop. Realistic transparent PET transfer film with already arranged original generic colorful motifs, precise print detail, warm ivory tabletop, restrained coral and teal palette, soft daylight. The film is a finished production sheet, not a software layout. No people, no logos, no trademarks, no watermarks, no readable text, no invented certification or performance claims.';
const assets = [
  { name: 'hero-ready-film', ratio: '16:9', prompt: `${common} Wide hero composition: an elegant long printed gang sheet gently curves from a film roll on the right of the frame, a few blank cotton garment folds nearby; generous quiet negative space across the left third for HTML headline. Clean boutique print studio, sophisticated light shadows, visually clear transfer film rather than paper.` },
  { name: 'variant-ready-sheet', ratio: '1:1', prompt: `${common} Square product composition: one rectangular gang sheet lying flat, a slightly lifted transparent corner makes the film material unmistakable. A dozen vivid original botanical and abstract badge motifs are already arranged on the sheet. Entire finished sheet visible, organized studio product photograph.` },
  { name: 'measured-length-sheet', ratio: '1:1', prompt: `${common} Square product composition: a long narrow finished printed film sheet unrolls in a graceful S curve on the desk, with repeating rows of original floral and geometric motifs. Show continuous film length clearly, no rulers with numbers, no cutting or rearranging.` },
  { name: 'manual-sheet-detail', ratio: '1:1', prompt: `${common} Square product composition: close three-quarter view of the edge of a finished gang sheet on film, crisp saturated original abstract botanical transfers and clean transparent negative spaces, subtle light reflections on the film. A folded plain charcoal cotton shirt beside it. No hands or printer interface.` },
  { name: 'uv-transfer-film', ratio: '1:1', prompt: `${common} Square product composition: glossy UV DTF transfer film with small original colorful floral and geometric decals, beside a plain unbranded clear glass tumbler and a matte white ceramic cup. Transparent carrier edges visible; do not show decals being applied or claim physical test results.` },
];
await mkdir(output, { recursive: true });
let journal = { model, pricingSource: 'https://fal.ai/pricing', estimatedUsdPerImage: 0.08, assets: {} };
try { journal = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let saveChain = Promise.resolve();
function save() {
  const snapshot = `${JSON.stringify(journal, null, 2)}\n`;
  saveChain = saveChain.then(() => writeFile(journalPath, snapshot));
  return saveChain;
}
async function api(url, options = {}) {
  if (new URL(url).origin !== 'https://queue.fal.run') throw new Error('Unexpected queue destination');
  const response = await fetch(url, { ...options, headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`FAL HTTP ${response.status}`);
  return response.json();
}
for (const asset of assets) {
  if (journal.assets[asset.name]?.localFile) { console.log(`${asset.name}: already downloaded`); continue; }
  if (!journal.assets[asset.name]?.requestId) {
    const submitted = await api(`https://queue.fal.run/${model}`, { method: 'POST', body: JSON.stringify({ prompt: asset.prompt, aspect_ratio: asset.ratio, num_images: 1, resolution: '1K', output_format: 'jpeg', limit_generations: true, enable_web_search: false }) });
    journal.assets[asset.name] = { requestId: submitted.request_id, statusUrl: submitted.status_url, responseUrl: submitted.response_url, prompt: asset.prompt, submittedAt: new Date().toISOString() };
    await save();
    console.log(`${asset.name}: submitted ${submitted.request_id}`);
  }
}
// Re-running resumes the same provider requests rather than buying duplicate images.
await Promise.all(assets.map(async (asset) => {
  const entry = journal.assets[asset.name];
  if (entry.localFile) return;
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = await api(entry.statusUrl);
    if (status.status === 'COMPLETED') {
      if (status.error) throw new Error(`${asset.name}: provider generation failed`);
      const result = await api(entry.responseUrl);
      const generated = result.images?.[0];
      if (!generated?.url || result.images.length !== 1) throw new Error('Unexpected image result');
      const imageUrl = new URL(generated.url);
      if (imageUrl.protocol !== 'https:' || !/(^|\.)fal\.media$|(^|\.)fal\.ai$|(^|\.)googleapis\.com$/.test(imageUrl.hostname)) throw new Error('Unexpected generated image host');
      const response = await fetch(imageUrl, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`Image download HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Unexpected image size');
      await writeFile(path.join(output, `${asset.name}.jpg`), bytes);
      Object.assign(entry, { localFile: `${asset.name}.jpg`, bytes: bytes.length, width: generated.width, height: generated.height, completedAt: new Date().toISOString(), metrics: status.metrics });
      await save();
      console.log(`${asset.name}: downloaded ${bytes.length} bytes`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error(`${asset.name}: deadline; re-run to resume saved request`);
}));
