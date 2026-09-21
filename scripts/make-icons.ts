// 拡張機能のアイコン（PNG）を依存なしで生成する。ツールバー用。シークバーの上に山が立つ絵を 1 色で。
//   npx tsx scripts/make-icons.ts   → src/extension/icons/icon{16,32,48,128}.png
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const ACCENT = [0x5e, 0xea, 0xd4]; // styles.css の --jevseek-accent と揃える
const BG = [0x0f, 0x0f, 0x0f];

function render(size: number): Uint8Array {
  const ss = 4, n = size * ss; // スーパーサンプリング
  const px = new Float32Array(n * n * 4);
  const r = n * 0.22; // 角丸
  const inRounded = (x: number, y: number) => {
    const cx = Math.min(Math.max(x, r), n - r), cy = Math.min(Math.max(y, r), n - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // 山：中心 (0.5, 0.62)、幅 0.56、高さ 0.34 のガウス風の丘 + 底線
  const baseY = n * 0.74, lineH = n * 0.07;
  const hill = (x: number) => { const t = (x / n - 0.5) / 0.19; return Math.exp(-t * t) * n * 0.36; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    if (!inRounded(x + 0.5, y + 0.5)) continue;
    const onLine = y >= baseY && y < baseY + lineH;
    const onHill = y < baseY && y >= baseY - hill(x + 0.5) && Math.abs(x / n - 0.5) < 0.42;
    const c = onLine || onHill ? ACCENT : BG;
    px[i] = c[0]!; px[i + 1] = c[1]!; px[i + 2] = c[2]!; px[i + 3] = 255;
  }
  // ダウンサンプル
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r0 = 0, g0 = 0, b0 = 0, a = 0;
    for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) {
      const i = ((y * ss + dy) * n + (x * ss + dx)) * 4;
      const al = px[i + 3]! / 255;
      r0 += px[i]! * al; g0 += px[i + 1]! * al; b0 += px[i + 2]! * al; a += al;
    }
    const o = (y * size + x) * 4;
    out[o] = a ? Math.round(r0 / a) : 0; out[o + 1] = a ? Math.round(g0 / a) : 0; out[o + 2] = a ? Math.round(b0 / a) : 0;
    out[o + 3] = Math.round((a / (ss * ss)) * 255);
  }
  return out;
}

function png(size: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const table = new Int32Array(256).map((_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b: Buffer): number { let c = -1; for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8); return ~c; }

mkdirSync("src/extension/icons", { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`src/extension/icons/icon${s}.png`, png(s, render(s)));
console.log("icons → src/extension/icons/");
