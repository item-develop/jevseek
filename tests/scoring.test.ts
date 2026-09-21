import { describe, it, expect } from "vitest";
import { smooth, pickPeaks, type HeatPoint, type Segment } from "../src/core";

const segs: Segment[] = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, start: i * 25, end: i * 25 + 25, text: `t${i}` }));
const pts = (ps: number[]): HeatPoint[] => ps.map((p, i) => ({ id: `s${i}`, start: i * 25, end: i * 25 + 25, p }));

describe("smooth", () => {
  it("keeps values in [0,1] and preserves length", () => {
    const out = smooth(pts([0, 1, 0, 0, 0, 0, 0, 0, 0, 1]));
    expect(out).toHaveLength(10);
    expect(out.every((p) => p.p >= 0 && p.p <= 1)).toBe(true);
    expect(out[1]!.p).toBeGreaterThan(out[0]!.p);
  });
});

describe("pickPeaks", () => {
  it("returns local maxima above threshold, sorted by p, separated by minGap", () => {
    const hits = pickPeaks(pts([0.1, 0.9, 0.8, 0.1, 0.1, 0.7, 0.2, 0.1, 0.95, 0.3]), segs, { threshold: 0.5, minGapSec: 30, max: 5 });
    expect(hits.map((h) => h.id)).toEqual(["s8", "s1", "s5"]);
    expect(hits[0]!.text).toBe("t8");
  });
  it("honours max", () => {
    const hits = pickPeaks(pts([0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1, 0.9, 0.1]), segs, { threshold: 0.5, minGapSec: 30, max: 2 });
    expect(hits).toHaveLength(2);
  });
});
