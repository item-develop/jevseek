// キュー → セグメント（Jev に渡す窓）。docs/03 §2。
import type { Cue, Segment } from "./types";

export interface ChunkOptions { windowSec: number; windowChars: number }

/**
 * 時間か文字数のどちらかが窓を超えたら区切る。文末（。！？.!?）で切れるならそこで切る。
 * 窓は重ねない（重ねるとヒートマップが二重に立つ）。
 */
export function chunkCues(cues: Cue[], opts: ChunkOptions): Segment[] {
  const segs: Segment[] = [];
  let buf: Cue[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    const first = buf[0]!, last = buf[buf.length - 1]!;
    segs.push({
      id: `s${segs.length}`,
      start: round1(first.start),
      end: round1(last.start + last.dur),
      text: buf.map((c) => c.text).join(" ").replace(/\s+/g, " ").trim(),
    });
    buf = [];
  };
  for (const c of cues) {
    buf.push(c);
    const span = c.start + c.dur - buf[0]!.start;
    const chars = buf.reduce((n, x) => n + x.text.length, 0);
    const sentenceEnd = /[。！？.!?]$/.test(c.text.trim());
    if (span >= opts.windowSec || chars >= opts.windowChars || (sentenceEnd && span >= opts.windowSec * 0.6)) flush();
  }
  flush();
  return segs;
}

/** ざっくりトークン見積もり。日本語は 1 文字 ≈ 1 トークン弱、英語は 4 文字 ≈ 1 トークン。保守的に */
export function estimateTokens(text: string): number {
  let cjk = 0, other = 0;
  for (const ch of text) (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? cjk++ : other++);
  return Math.ceil(cjk * 1.0 + other / 3.5);
}

/** セグメント列をトークン予算と最大件数で分割 */
export function batchSegments(segs: Segment[], maxPerRequest: number, tokenBudget = 20000): Segment[][] {
  const batches: Segment[][] = [];
  let cur: Segment[] = [], tokens = 0;
  for (const s of segs) {
    const t = estimateTokens(s.text) + 24; // 質問 1 本ぶんの固定コスト
    if (cur.length > 0 && (cur.length >= maxPerRequest || tokens + t > tokenBudget)) {
      batches.push(cur); cur = []; tokens = 0;
    }
    cur.push(s); tokens += t;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
