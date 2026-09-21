// 答え → ヒートマップとピーク。docs/03 §4。
import type { HeatPoint, Hit, Segment } from "./types";

/**
 * 隣接平滑化（0.25 / 0.5 / 0.25）。ただしピークは下げない（max を取る）。
 * 孤立した 1 セグメントのヒットが半減して閾値を割るのを防ぐため。
 */
export function smooth(points: HeatPoint[]): HeatPoint[] {
  return points.map((p, i) => {
    const prev = points[i - 1]?.p ?? p.p, next = points[i + 1]?.p ?? p.p;
    return { ...p, p: clamp01(Math.max(p.p, 0.25 * prev + 0.5 * p.p + 0.25 * next)) };
  });
}

/** 極大値を閾値以上・最小間隔で選ぶ。p 降順 */
export function pickPeaks(points: HeatPoint[], segments: Segment[], opts: { threshold: number; minGapSec: number; max: number }): Hit[] {
  const byId = new Map(segments.map((s) => [s.id, s]));
  const cands = points
    .filter((p, i) => p.p >= opts.threshold && p.p >= (points[i - 1]?.p ?? -1) && p.p >= (points[i + 1]?.p ?? -1))
    .sort((a, b) => b.p - a.p);
  const hits: Hit[] = [];
  for (const c of cands) {
    if (hits.some((h) => Math.abs(h.start - c.start) < opts.minGapSec)) continue;
    hits.push({ id: c.id, start: c.start, end: c.end, p: round3(c.p), text: byId.get(c.id)?.text ?? "" });
    if (hits.length >= opts.max) break;
  }
  return hits;
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const round3 = (x: number) => Math.round(x * 1000) / 1000;
