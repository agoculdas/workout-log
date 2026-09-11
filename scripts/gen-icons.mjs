// Generates placeholder PWA icons: dark rounded square with a light dumbbell glyph.
// Run: node scripts/gen-icons.mjs
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

const BG = [9, 9, 11];        // zinc-950
const FG = [212, 252, 121];   // lime-ish accent

function rect(px, size, x0, y0, x1, y1, color) {
  for (let y = Math.max(0, y0 | 0); y < Math.min(size, y1 | 0); y++) {
    for (let x = Math.max(0, x0 | 0); x < Math.min(size, x1 | 0); x++) {
      const i = (size * y + x) << 2;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

function make(size, maskable) {
  const png = new PNG({ width: size, height: size });
  rect(png.data, size, 0, 0, size, size, BG);
  const u = size / 32;              // unit
  const pad = maskable ? 9 * u : 6 * u; // maskable keeps the glyph in the safe zone
  const cy = size / 2;
  const h = size - pad * 2;
  // dumbbell: two end plates, two inner plates, a bar
  rect(png.data, size, pad, cy - h * 0.30, pad + u * 2.2, cy + h * 0.30, FG);
  rect(png.data, size, size - pad - u * 2.2, cy - h * 0.30, size - pad, cy + h * 0.30, FG);
  rect(png.data, size, pad + u * 3.2, cy - h * 0.19, pad + u * 5.0, cy + h * 0.19, FG);
  rect(png.data, size, size - pad - u * 5.0, cy - h * 0.19, size - pad - u * 3.2, cy + h * 0.19, FG);
  rect(png.data, size, pad + u * 5.0, cy - u * 1.4, size - pad - u * 5.0, cy + u * 1.4, FG);
  return PNG.sync.write(png);
}

const files = [
  ['pwa-192x192.png', make(192, false)],
  ['pwa-512x512.png', make(512, false)],
  ['maskable-512x512.png', make(512, true)],
  ['apple-touch-icon.png', make(180, false)],
  ['favicon.png', make(64, false)],
];
for (const [name, buf] of files) {
  writeFileSync(resolve(outDir, name), buf);
  console.log('wrote public/' + name, buf.length + 'b');
}
