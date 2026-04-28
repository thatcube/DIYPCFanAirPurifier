#!/usr/bin/env node
// ─── Asset optimization pipeline ──────────────────────────────────────
// Reads source GLBs from ./assets/ and writes optimized copies into
// ./public/assets/ (which Vite serves as /assets/*).
//
// Texture-only optimization by default — the dominant cost in this
// project's GLBs is uncompressed RGBA PNGs at multi-K resolutions.
// Resizing + WebP encoding typically takes a 80MB GLB down to <5MB
// without touching geometry, so no DRACO/Meshopt decoder wiring is
// needed on the client.
//
// Run:
//   npm run assets:optimize           # optimize all GLBs
//   npm run assets:optimize:dry       # report sizes only, no writes
//   npm run assets:optimize -- cat.glb skateboard.glb   # subset
//
// The script is idempotent: if the source GLB hasn't changed since
// the last optimized output, it's skipped.

import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, flatten, textureCompress, resample, quantize,
} from '@gltf-transform/functions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'assets');
const OUT_DIR = path.join(ROOT, 'public', 'assets');

// ── Per-model overrides (texture caps, since some models warrant more) ──
const PROFILE = {
  // Cat models: small in-world, never previewed > ~512px
  'cat.glb': { maxTex: 1024 },
  'tooncat.glb': { maxTex: 1024 },
  'totodile.glb': { maxTex: 1024 },
  'bababooey_cat.glb': { maxTex: 1024 },
  'munchkin_cat.glb': { maxTex: 1024 },
  // Hand-held / floor props: viewed up close
  'macbook.glb': { maxTex: 2048 },
  'skateboard.glb': { maxTex: 2048 },
};
const DEFAULT_PROFILE = { maxTex: 1024 };

// ── CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry') || args.includes('-n');
const FORCE = args.includes('--force') || args.includes('-f');
const FILES = args.filter(a => a.endsWith('.glb'));

// ── Helpers ──────────────────────────────────────────────────────────
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function listGlbs() {
  const entries = await fs.readdir(SRC_DIR);
  return entries.filter(n => n.endsWith('.glb'));
}

async function isStale(src, dst) {
  if (!existsSync(dst)) return true;
  const [s, d] = [statSync(src), statSync(dst)];
  return s.mtimeMs > d.mtimeMs;
}

// ── Optimize one GLB ─────────────────────────────────────────────────
async function optimizeOne(filename) {
  const src = path.join(SRC_DIR, filename);
  const dst = path.join(OUT_DIR, filename);
  const profile = PROFILE[filename] || DEFAULT_PROFILE;

  const srcSize = statSync(src).size;

  if (DRY_RUN) {
    const dstSize = existsSync(dst) ? statSync(dst).size : 0;
    console.log(`  ${filename.padEnd(24)} src=${fmtBytes(srcSize).padStart(10)}   dst=${fmtBytes(dstSize).padStart(10)}`);
    return;
  }

  if (!FORCE && !(await isStale(src, dst))) {
    console.log(`  ${filename.padEnd(24)} (skipped, up to date — re-run with --force to redo)`);
    return;
  }

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const document = await io.read(src);

  await document.transform(
    // Trim unused vertex attributes / nodes / animations.
    prune({ keepAttributes: false, keepLeaves: false }),
    // Merge identical accessors / textures / materials.
    dedup(),
    // Collapse identity transforms onto leaves to enable better dedup.
    flatten(),
    // Merge identical vertices.
    weld(),
    // Reduce keyframe density without changing animation visibly.
    resample(),
    // Re-encode + cap textures at the per-model max. WebP gives ~75–90%
    // shrink vs. uncompressed PNG at indistinguishable visual quality
    // for the small in-scene models here.
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [profile.maxTex, profile.maxTex],
      quality: 88,
    }),
    // Quantize vertex/morph attributes to 16-bit. Three.js GLTFLoader
    // handles KHR_mesh_quantization natively (no decoder wiring needed).
    // Especially impactful on models with hundreds of morph targets.
    quantize({
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeColor: 8,
      quantizeWeight: 8,
      quantizeGeneric: 12,
    }),
    // Final pass to sweep anything the above passes orphaned.
    prune({ keepAttributes: false, keepLeaves: false }),
  );

  await fs.mkdir(OUT_DIR, { recursive: true });
  await io.write(dst, document);

  const dstSize = statSync(dst).size;
  const pct = ((1 - dstSize / srcSize) * 100).toFixed(1);
  console.log(
    `  ${filename.padEnd(24)} ${fmtBytes(srcSize).padStart(10)} → ${fmtBytes(dstSize).padStart(10)}   (-${pct}%)`
  );
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(SRC_DIR)) {
    console.error(`✗ Source dir not found: ${SRC_DIR}`);
    process.exit(1);
  }

  const files = FILES.length ? FILES : await listGlbs();
  if (!files.length) {
    console.log('No GLBs to optimize.');
    return;
  }

  console.log(DRY_RUN ? 'Dry run — sizes only:' : 'Optimizing GLBs:');
  let totalSrc = 0, totalDst = 0;

  for (const f of files) {
    const src = path.join(SRC_DIR, f);
    if (!existsSync(src)) {
      console.warn(`  ${f.padEnd(24)} (not found in ${SRC_DIR}, skipped)`);
      continue;
    }
    totalSrc += statSync(src).size;
    await optimizeOne(f);
    const dst = path.join(OUT_DIR, f);
    if (existsSync(dst)) totalDst += statSync(dst).size;
  }

  if (totalSrc > 0) {
    const pct = ((1 - totalDst / totalSrc) * 100).toFixed(1);
    console.log(
      `\nTotal: ${fmtBytes(totalSrc)} → ${fmtBytes(totalDst)}   (-${pct}%)`
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
