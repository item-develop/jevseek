// state と questions の組み立て。docs/03 §3。
// - セグメント 1 個 = 質問 1 本。全部を 1 リクエストに詰める（分割は batchSegments）
// - 「該当なし」は choice に混ぜず、別の boolean（any）で聞く
// - 閾値・例外規定を質問文に書かない
import type { Segment, VideoMeta } from "./types";

export type QuestionType = "boolean" | "score";

export interface BooleanQuestion { type: "boolean"; instructions: string; criteria?: { true?: string | null; false?: string | null } }
export interface ScoreQuestion { type: "score"; instructions: string; criteria: string[] }
export type SeekQuestion = BooleanQuestion | ScoreQuestion;

/** JSON にそのまま載る形（undefined を含めない） */
export interface SeekState {
  task: string;
  query: string;
  video: Record<string, string>;
  segments: { id: string; t: string; text: string }[];
}

export const SCORE_LEVELS = ["その話をしていない", "少し触れている", "まさにその話をしている"] as const;

export function buildState(query: string, meta: VideoMeta, segments: Segment[]): SeekState {
  return {
    task: "動画の字幕を時間順のセグメントに分けたもの。query が指す内容を話している箇所を探す。",
    query,
    video: Object.fromEntries(Object.entries({ title: meta.title, channel: meta.channel, lang: meta.lang }).filter(([, v]) => typeof v === "string")) as Record<string, string>,
    segments: segments.map((s) => ({ id: s.id, t: `${fmt(s.start)}-${fmt(s.end)}`, text: s.text })),
  };
}

export function buildQuestions(segments: Segment[], type: QuestionType): Record<string, SeekQuestion> {
  const qs: Record<string, SeekQuestion> = {};
  for (const s of segments) {
    qs[s.id] =
      type === "boolean"
        ? {
            type: "boolean",
            instructions: `セグメント ${s.id} は query の内容を話しているか。`,
            criteria: { true: "話している", false: "話していない" },
          }
        : {
            type: "score",
            instructions: `セグメント ${s.id} は query の内容をどの程度話しているか。判断対象は ${s.id} の本文。`,
            criteria: [...SCORE_LEVELS],
          };
  }
  // 逃げ道は別の問いにする（practice.md §2.1）
  qs["any"] = {
    type: "boolean",
    instructions: "この字幕全体の中に、query が指す内容を話している箇所が 1 つでもあるか。",
    criteria: { true: "ある", false: "ない（動画はその話題を扱っていない）" },
  };
  return qs;
}

const fmt = (sec: number) => {
  const s = Math.floor(sec), m = Math.floor(s / 60), r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
};
