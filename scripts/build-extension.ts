// 拡張機能を dist/extension にビルドする。manifest と CSS はコピー、TS は esbuild で 1 ファイルずつに束ねる。
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const out = "dist/extension";
await mkdir(out, { recursive: true });
await build({
  entryPoints: {
    content: "src/extension/content.ts",
    "page-bridge": "src/extension/page-bridge.ts",
    background: "src/extension/background.ts",
  },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: out,
  sourcemap: "inline",
  logLevel: "info",
});
await cp("src/extension/manifest.json", `${out}/manifest.json`);
await cp("src/extension/styles.css", `${out}/styles.css`);
await cp("src/extension/icons", `${out}/icons`, { recursive: true });
console.log(`built → ${out}  (chrome://extensions → パッケージ化されていない拡張機能を読み込む → このフォルダ)`);
