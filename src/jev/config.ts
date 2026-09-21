import { DEFAULT_CONFIG, type SeekConfig } from "../core";
import { jevEvaluator, mockEvaluator, type Evaluator } from "./evaluate";

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): SeekConfig {
  const num = (k: string, d: number) => (env[k] ? Number(env[k]) : d);
  return {
    ...DEFAULT_CONFIG,
    questionType: env.SEEK_QUESTION_TYPE === "score" ? "score" : "boolean",
    maxSegmentsPerRequest: num("SEEK_MAX_SEGMENTS_PER_REQUEST", DEFAULT_CONFIG.maxSegmentsPerRequest),
    windowSec: num("SEEK_WINDOW_SEC", DEFAULT_CONFIG.windowSec),
    windowChars: num("SEEK_WINDOW_CHARS", DEFAULT_CONFIG.windowChars),
  };
}

export function evaluatorFromEnv(env: NodeJS.ProcessEnv = process.env, force?: "jev" | "mock"): Evaluator {
  const wantJev = force === "jev" || (force !== "mock" && Boolean(env.AI_GATEWAY_API_KEY));
  if (wantJev && !env.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY が未設定です（.env）");
  return wantJev ? jevEvaluator(env.JEV_MODEL ?? "typesafe-ai/jev") : mockEvaluator();
}
