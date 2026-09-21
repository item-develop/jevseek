import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Experimental_EvaluationMockModelV4 } from "ai/test";
import { chunkCues, type Transcript } from "../src/core";
import { jevEvaluator, mockEvaluator, seek } from "../src/jev/evaluate";
import { DEFAULT_CONFIG } from "../src/core";

const tr = JSON.parse(readFileSync("fixtures/transcripts/sample_ja.json", "utf8")) as Transcript;
const segments = chunkCues(tr.cues, { windowSec: 25, windowChars: 140 });

describe("seek() pipeline", () => {
  it("works end-to-end with the keyword mock", async () => {
    const res = await seek({ query: "他社機 比較", meta: tr.meta, segments }, mockEvaluator(), DEFAULT_CONFIG);
    expect(res.backend).toBe("mock");
    expect(res.heat).toHaveLength(segments.length);
    expect(res.hits[0]!.start).toBeGreaterThanOrEqual(340);
  });

  it("maps AI SDK evaluation answers into heat and hits (jev path with a mock model)", async () => {
    // 「値段」を含むセグメントに高い P(true) を返す偽 Jev
    const model = new Experimental_EvaluationMockModelV4({
      provider: "typesafe-ai", modelId: "jev-mock",
      supportedQuestionTypes: ["boolean", "score", "choice"],
      doEvaluate: async ({ state, questions }) => {
        const st = state as { segments: { id: string; text: string }[] };
        const answers: Record<string, { type: "boolean"; probability: number }> = {};
        for (const id of Object.keys(questions)) {
          const seg = st.segments.find((s) => s.id === id);
          answers[id] = { type: "boolean", probability: id === "any" ? 0.9 : seg && /円|値段|価格/.test(seg.text) ? 0.92 : 0.04 };
        }
        return { answers, usage: { inputTokens: 1000, outputTokens: 0, totalTokens: 1000 }, warnings: [] };
      },
    });
    const cfg = { ...DEFAULT_CONFIG, maxSegmentsPerRequest: 8 }; // 分割経路も通す
    const res = await seek({ query: "値段を言ったところ", meta: tr.meta, segments }, jevEvaluator(model), cfg);
    expect(res.backend).toBe("jev");
    expect(res.usage?.requests).toBeGreaterThan(1);
    expect(res.anyP).toBeCloseTo(0.9, 5);
    expect(res.hits[0]!.start).toBeGreaterThanOrEqual(170);
    expect(res.hits[0]!.start).toBeLessThanOrEqual(230);
  });
});
