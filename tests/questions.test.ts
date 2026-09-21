import { describe, it, expect } from "vitest";
import { buildQuestions, buildState, type Segment } from "../src/core";

const segs: Segment[] = [{ id: "s0", start: 0, end: 25, text: "a" }, { id: "s1", start: 25, end: 50, text: "b" }];

describe("questions (docs/03)", () => {
  it("one question per segment plus a separate 'any' escape hatch", () => {
    const qs = buildQuestions(segs, "boolean");
    expect(Object.keys(qs)).toEqual(["s0", "s1", "any"]);
    expect(qs["any"]!.type).toBe("boolean");
  });
  it("score questions carry ordered levels", () => {
    const qs = buildQuestions(segs, "score");
    expect(qs["s0"]!.type).toBe("score");
    expect((qs["s0"] as { criteria: string[] }).criteria).toHaveLength(3);
  });
  it("never writes thresholds or 'none of the above' into instructions", () => {
    const qs = buildQuestions(segs, "boolean");
    for (const q of Object.values(qs)) {
      expect(q.instructions).not.toMatch(/0\.\d|閾値|該当なし/);
    }
  });
  it("state puts the query beside the segments", () => {
    const st = buildState("値段を言ったところ", { videoId: "x" }, segs);
    expect(st.query).toBe("値段を言ったところ");
    expect(st.segments.map((s) => s.id)).toEqual(["s0", "s1"]);
  });
});
