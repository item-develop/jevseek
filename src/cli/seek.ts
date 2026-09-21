// CLI: ブラウザなしで検証する。
//   npm run seek -- --url https://www.youtube.com/watch?v=XXXX --q "値段を言ったところ"
//   npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "値段を言ったところ" [--mock] [--score] [--json]
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { chunkCues, extractVideoId, fmtTime, type Transcript } from "../core";
import { seek } from "../jev/evaluate";
import { configFromEnv, evaluatorFromEnv } from "../jev/config";
import { setRecording } from "../jev/record";
import { fetchTranscriptServerSide } from "../server/transcript";

const args = parseArgs(process.argv.slice(2));
const q = args.q;
if (!q || (!args.url && !args.fixture)) {
  console.error('usage: npm run seek -- (--url <youtube url> | --fixture <json>) --q "<query>" [--mock] [--score] [--json] [--record]');
  process.exit(1);
}
if (args.record) setRecording(true);

const cfg = configFromEnv();
if (args.score) cfg.questionType = "score";
const ev = evaluatorFromEnv(process.env, args.mock ? "mock" : undefined);

const tr: Transcript = args.fixture
  ? (JSON.parse(await readFile(args.fixture, "utf8")) as Transcript)
  : await fetchTranscriptServerSide(extractVideoId(args.url!) ?? args.url!);

const segments = chunkCues(tr.cues, { windowSec: cfg.windowSec, windowChars: cfg.windowChars });
const res = await seek({ query: q, meta: tr.meta, segments }, ev, cfg);

if (args.json) {
  console.log(JSON.stringify(res, null, 2));
} else {
  console.log(`\n${tr.meta.title ?? tr.meta.videoId}  (${segments.length} segments, ${res.backend}, ${res.latencyMs}ms, ${res.usage?.requests} req${res.usage?.inputTokens ? `, ${res.usage.inputTokens} tok` : ""})`);
  console.log(`query: ${q}   any=${res.anyP.toFixed(2)}\n`);
  if (res.hits.length === 0) console.log("  （ヒットなし）");
  for (const h of res.hits) console.log(`  ${fmtTime(h.start).padStart(7)}  ${bar(h.p)}  ${h.p.toFixed(2)}  ${h.text.slice(0, 60)}`);
  console.log("\nheat:", res.heat.map((h) => h.p >= 0.75 ? "█" : h.p >= 0.5 ? "▓" : h.p >= 0.25 ? "▒" : "·").join(""));
}

function bar(p: number) { const n = Math.round(p * 10); return "▮".repeat(n) + "▯".repeat(10 - n); }
function parseArgs(argv: string[]): Record<string, string | undefined> & { mock?: string; score?: string; json?: string; record?: string } {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const k = a.slice(2), v = argv[i + 1];
      if (v && !v.startsWith("--")) { out[k] = v; i++; } else out[k] = "1";
    }
  }
  return out;
}
