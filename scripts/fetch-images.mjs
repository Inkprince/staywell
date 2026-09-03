/**
 * Downloads every Unsplash image the site references into public/images/,
 * so the app never fetches a third-party CDN at runtime.
 *
 * Run once (and whenever an image id changes): `node scripts/fetch-images.mjs`
 * Safe to re-run — existing files of the right size are kept.
 *
 * Source URLs are recorded here as provenance under the Unsplash license.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(process.cwd(), 'public', 'images');

/** photo id → download width (the largest width the UI requests for it). */
const PHOTOS = [
  ['photo-1551882547-ff40c63fe5fa', 1400], // hotel lounge — facilities, Meet Proof
  ['photo-1521587760476-6c12a4b040da', 800], // reading room
  ['photo-1584622650111-993a426fbf0a', 800], // soaking bathroom
  ['photo-1517248135467-4c7edcad34c4', 800], // river terrace
  ['photo-1495474472287-4d71bcdd2085', 800], // espresso bar
  ['photo-1552465011-b4e21bf6e79a', 1200], // green terraces
  ['photo-1518548419970-58e3b4079ab2', 1200], // riverside walk
  ['photo-1433086966358-54859d0ed716', 1200], // pocket garden
  ['photo-1537996194471-e657df975ab4', 1200], // sculpture garden
  ['photo-1564501049412-61c2a3083791', 2070], // hero exterior
  ['photo-1438761681033-6461ffad8d80', 400], // testimonial avatar
  ['photo-1507003211169-0a1dd7228f2d', 400], // testimonial avatar
  ['photo-1534528741775-53994a69daeb', 400], // testimonial avatar
  ['photo-1600210492486-724fe5c67fb0', 1400], // Garden King
  ['photo-1590490360182-c33d57733427', 1400], // City View King
  ['photo-1591088398332-8a7791972843', 1400], // Terrace Studio
  ['photo-1582719478250-c89cae4dc85b', 1400], // River Suite
  ['photo-1618221195710-dd6b41faaea6', 1400], // Penthouse Residence
];

const MIN_BYTES = 10_000; // a real photo, not an error page
const ATTEMPTS = 5;

async function fetchWithRetries(id, width) {
  const url = `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=85`;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) throw new Error(`content-type ${type}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength < MIN_BYTES) throw new Error(`only ${bytes.byteLength} bytes`);
      return bytes;
    } catch (cause) {
      console.warn(`  attempt ${attempt}/${ATTEMPTS} failed: ${cause.message}`);
      if (attempt === ATTEMPTS) throw cause;
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  let failed = 0;

  for (const [id, width] of PHOTOS) {
    const file = path.join(OUT_DIR, `${id}.jpg`);
    if (existsSync(file)) {
      const existing = await readFile(file);
      if (existing.byteLength >= MIN_BYTES) {
        console.log(`kept   ${id}.jpg (${existing.byteLength} bytes)`);
        continue;
      }
    }
    console.log(`fetch  ${id}.jpg (w=${width})`);
    try {
      const bytes = await fetchWithRetries(id, width);
      await writeFile(file, bytes);
      console.log(`  saved ${bytes.byteLength} bytes`);
    } catch (cause) {
      failed++;
      console.error(`  FAILED: ${cause.message}`);
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} image(s) failed — re-run this script when the network allows.`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${PHOTOS.length} images present in public/images.`);
}

main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
