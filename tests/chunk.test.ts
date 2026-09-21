import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chunkCues, batchSegments, estimateTokens, type Transcript } from "../src/core";

const tr = JSON.parse(readFileSync("fixtures/transcripts/sample_ja.json", "utf8")) as Transcript;

describe("chunkCues", () => {
  it("covers the whole transcript in order without overlap", () => {
    const segs = chunkCues(tr.cues, { windowSec: 25, windowChars: 140 });
    expect(segs.length).toBeGreaterThan(10);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.start).toBeGreaterThanOrEqual(segs[i - 1]!.end - 0.11);
    expect(segs[0]!.start).toBe(0);
    expect(segs.at(-1)!.end).toBeGreaterThanOrEqual(528);
  });
  it("keeps every segment within the window limits", () => {
    const segs = chunkCues(tr.cues, { windowSec: 25, windowChars: 140 });
    for (const s of segs) {
      expect(s.end - s.start).toBeLessThanOrEqual(25 + 8);
      expect(s.text.length).toBeLessThanOrEqual(140 + 60);
    }
  });
});

describe("batchSegments", () => {
  it("splits by max count", () => {
    const segs = chunkCues(tr.cues, { windowSec: 25, windowChars: 140 });
    const b = batchSegments(segs, 5);
    expect(b.every((x) => x.length <= 5)).toBe(true);
    expect(b.flat().length).toBe(segs.length);
  });
  it("splits by token budget", () => {
    const segs = chunkCues(tr.cues, { windowSec: 25, windowChars: 140 });
    const b = batchSegments(segs, 1000, 300);
    expect(b.length).toBeGreaterThan(1);
  });
  it("estimates CJK heavier than latin", () => {
    expect(estimateTokens("あいうえおかきくけこ")).toBeGreaterThan(estimateTokens("abcdefghij"));
  });
});
