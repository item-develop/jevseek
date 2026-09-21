// 共有型。src/core は DOM・Node 固有 API に依存しない（拡張機能・サーバー・CLI の全部で使う）。

/** 字幕の 1 キュー（YouTube json3 の event 1 つに相当） */
export interface Cue {
  start: number; // 秒
  dur: number;   // 秒
  text: string;
}

/** Jev に渡す単位。複数キューを窓にまとめたもの */
export interface Segment {
  id: string;    // "s0", "s1", ...
  start: number; // 秒
  end: number;   // 秒
  text: string;
}

export interface VideoMeta {
  videoId: string;
  title?: string;
  channel?: string;
  lang?: string;      // 字幕言語
  auto?: boolean;     // 自動生成字幕か
  duration?: number;  // 秒
}

export interface Transcript {
  meta: VideoMeta;
  cues: Cue[];
}

/** サーバーへの検索リクエスト。字幕はクライアント側で取得して送る（サーバーは YouTube を見に行かなくてよい） */
export interface SeekRequest {
  query: string;
  meta: VideoMeta;
  segments: Segment[];
  /** 省略時はサーバー設定（SEEK_QUESTION_TYPE） */
  questionType?: "boolean" | "score";
}

export interface HeatPoint {
  id: string;
  start: number;
  end: number;
  p: number; // 0..1（boolean の P(true) または score/levels-1）
}

export interface Hit {
  id: string;
  start: number;
  end: number;
  p: number;
  text: string;
}

export interface SeekResponse {
  query: string;
  backend: "jev" | "mock";
  latencyMs: number;
  /** 全セグメントの熱量（シークバー描画用。平滑化済み） */
  heat: HeatPoint[];
  /** 上位のピーク（最大 5）。start 順ではなく p の降順 */
  hits: Hit[];
  /** 「この動画にその箇所はあるか」の別問い（該当なしの判定。choice に混ぜない） */
  anyP: number;
  usage?: { inputTokens?: number; requests: number };
  error?: string;
}

export interface SeekConfig {
  questionType: "boolean" | "score";
  maxSegmentsPerRequest: number;
  windowSec: number;
  windowChars: number;
  /** ピーク抽出 */
  peakThreshold: number;   // 既定 0.5
  peakMinGapSec: number;   // 既定 30
  maxHits: number;         // 既定 5
}

export const DEFAULT_CONFIG: SeekConfig = {
  questionType: "boolean",
  maxSegmentsPerRequest: 120,
  windowSec: 25,
  windowChars: 140,
  peakThreshold: 0.5,
  peakMinGapSec: 30,
  maxHits: 5,
};
