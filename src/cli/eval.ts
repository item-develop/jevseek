// 評価: fixtures/eval/*.json のクエリを回し、期待区間に hit@1 / hit@3 が入るかを出す（docs/05）。
//   npm run eval                 # 全ファイル
//   npm run eval -- --mock       # Mock で（配線確認用。精度は見ない）
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { chunkCues, fmtTime, type Transcript } from "../core";
import { seek } from "../jev/evaluate";
import { configFromEnv, evaluatorFromEnv } from "../jev/config";

interface EvalFile { transcript: string; tolerance?: number; queries: { q: string; expect: [number, number][]; note?: string }[] }

const mock = process.argv.includes("--mock");
const cfg = configFromEnv();
const ev = evaluatorFromEnv(process.env, mock ? "mock" : undefined);
const files = (await readdir("fixtures/eval")).filter((f) => f.endsWith(".json"));

let n = 0, hit1 = 0, hit3 = 0, totalMs = 0;
for (const f of files) {
  const ef = JSON.parse(await readFile(`fixtures/eval/${f}`, "utf8")) as EvalFile;
  const tr = JSON.parse(await readFile(ef.transcript, "utf8")) as Transcript;
  const segments = chunkCues(tr.cues, { windowSec: cfg.windowSec, windowChars: cfg.windowChars });
  const tol = ef.tolerance ?? 20;
  console.log(`\n${f}  (${tr.meta.title ?? tr.meta.videoId}, ${segments.length} seg, ${ev.name})`);
  for (const item of ef.queries) {
    const res = await seek({ query: item.q, meta: tr.meta, segments }, ev, cfg);
    totalMs += res.latencyMs; n++;
    const inRange = (t: number) => item.expect.some(([a, b]) => t >= a - tol && t <= b + tol);
    const h1 = res.hits[0] ? inRange(res.hits[0].start) : false;
    const h3 = res.hits.slice(0, 3).some((h) => inRange(h.start));
    hit1 += h1 ? 1 : 0; hit3 += h3 ? 1 : 0;
    console.log(`  ${h1 ? "✓" : h3 ? "△" : "✗"}  ${item.q.padEnd(18)} top=${res.hits[0] ? `${fmtTime(res.hits[0].start)} (${res.hits[0].p.toFixed(2)})` : "-"}  expect=${item.expect.map(([a, b]) => `${fmtTime(a)}-${fmtTime(b)}`).join(",")}  any=${res.anyP.toFixed(2)}  ${res.latencyMs}ms`);
  }
}
console.log(`\nhit@1 ${hit1}/${n}   hit@3 ${hit3}/${n}   avg ${Math.round(totalMs / Math.max(1, n))}ms`);
