// Jev 呼び出し。ここだけが `ai` の experimental_evaluate に依存する。
// - AI Gateway 経由（model: "typesafe-ai/jev"、AI_GATEWAY_API_KEY）
// - バッチは並列。リトライは SDK 既定（maxRetries）を 0 にして、失敗はそのまま返す（docs/03 §6）
// - キーが無ければ MockJudge（キーワード一致）で同じ形を返す。UI/CLI の開発に使う
import { experimental_evaluate as evaluate, type Experimental_EvaluationModel } from "ai";
import type { JSONObject } from "@ai-sdk/provider";
import {
  batchSegments, buildQuestions, buildState, pickPeaks, smooth,
  type HeatPoint, type SeekConfig, type SeekRequest, type SeekResponse, type Segment,
} from "../core";
import { record } from "./record";

export interface Evaluator {
  name: "jev" | "mock";
  /** 1 バッチ分。返り値は segmentId → p(0..1)、"any" を含む */
  run(req: SeekRequest, segments: Segment[], type: "boolean" | "score", signal?: AbortSignal): Promise<{ p: Record<string, number>; inputTokens?: number }>;
}

/** AI Gateway 経由の Jev */
export function jevEvaluator(model: Experimental_EvaluationModel | string): Evaluator {
  return {
    name: "jev",
    async run(req, segments, type, signal) {
      const state = buildState(req.query, req.meta, segments);
      const questions = buildQuestions(segments, type);
      const t0 = Date.now();
      const result = await withRetry(() => evaluate({ model: model as never, state: state as unknown as JSONObject, questions, maxRetries: 0, abortSignal: signal }), signal);
      const p: Record<string, number> = {};
      for (const [id, a] of Object.entries(result.answers)) {
        if (a.type === "boolean") p[id] = a.probability;
        else if (a.type === "score") p[id] = a.score / (SCORE_MAX);
      }
      await record({ kind: "jev", latencyMs: Date.now() - t0, request: { state, questions }, response: { answers: result.answers, usage: result.usage, providerMetadata: result.providerMetadata } });
      return { p, inputTokens: result.usage.inputTokens };
    },
  };
}
const SCORE_MAX = 2; // SCORE_LEVELS.length - 1

/**
 * 503 / 429 だけ短い間隔で再試行する。Jev は混雑時に 503 を即返すことがあり（2026-09-21 に観測）、
 * SDK の maxRetries は 2 秒からの指数バックオフで UI の 8 秒枠に収まらないため自前で持つ。
 */
const RETRY_DELAYS_MS = [300, 700, 1500];
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = statusOf(e);
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined || signal?.aborted || !(status === 503 || status === 429)) throw e;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
function statusOf(e: unknown): number | undefined {
  let cur: any = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur.statusCode === "number") return cur.statusCode;
    cur = cur.cause;
  }
  return undefined;
}
/** 上流のエラーを UI に出せる 1 行にする */
export function describeJevError(e: unknown): string {
  const status = statusOf(e);
  if (status === 503 || status === 429) return "Jev is busy right now. Try again in a moment";
  if ((e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError") return "Jev took too long to answer. Try again";
  return String((e as Error)?.message ?? e);
}

/** キーワード一致の Mock。Jev の「意味で当てる」挙動は再現しない（させない） */
export function mockEvaluator(): Evaluator {
  return {
    name: "mock",
    async run(req, segments) {
      const terms = req.query.replace(/[「」の話をしたところ言った]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
      const p: Record<string, number> = {};
      let any = 0;
      for (const s of segments) {
        const hits = terms.filter((t) => s.text.includes(t)).length;
        const v = terms.length ? Math.min(0.95, hits / terms.length) : 0;
        p[s.id] = v; any = Math.max(any, v);
      }
      p["any"] = any;
      await record({ kind: "mock", latencyMs: 0, request: { query: req.query, n: segments.length }, response: { p } });
      return { p };
    },
  };
}

/** リクエスト全体：分割 → 並列評価 → 合成 → 平滑化 → ピーク */
export async function seek(req: SeekRequest, ev: Evaluator, cfg: SeekConfig, signal?: AbortSignal): Promise<SeekResponse> {
  const t0 = Date.now();
  const type = req.questionType ?? cfg.questionType;
  const batches = batchSegments(req.segments, cfg.maxSegmentsPerRequest);
  const results = await Promise.all(batches.map((b) => ev.run(req, b, type, signal)));
  const p: Record<string, number> = {};
  let anyP = 0, inputTokens = 0;
  for (const r of results) {
    Object.assign(p, r.p);
    anyP = Math.max(anyP, r.p["any"] ?? 0);
    inputTokens += r.inputTokens ?? 0;
  }
  const raw: HeatPoint[] = req.segments.map((s) => ({ id: s.id, start: s.start, end: s.end, p: p[s.id] ?? 0 }));
  const heat = smooth(raw);
  const hits = pickPeaks(heat, req.segments, { threshold: cfg.peakThreshold, minGapSec: cfg.peakMinGapSec, max: cfg.maxHits });
  return { query: req.query, backend: ev.name, latencyMs: Date.now() - t0, heat, hits, anyP, usage: { inputTokens: inputTokens || undefined, requests: batches.length } };
}
