// YouTube 字幕（timedtext json3）のパースと、captionTracks の選択。DOM 非依存。
// 取得そのもの（fetch）は呼び出し側（拡張機能: 同一オリジン fetch / CLI: サーバー側 fetch）。
import type { Cue } from "./types";

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" = 自動生成
  vssId?: string; // ".ja" / "a.ja"（a = 自動生成）。プレイヤーの setOption に渡す
  name?: { simpleText?: string; runs?: { text: string }[] };
}

/** 優先言語 → 手動字幕を自動生成より優先。無ければ先頭 */
export function pickTrack(tracks: CaptionTrack[], preferred: string[] = ["ja", "en"]): CaptionTrack | undefined {
  if (tracks.length === 0) return undefined;
  const score = (t: CaptionTrack) => {
    const li = preferred.findIndex((l) => t.languageCode.startsWith(l));
    const lang = li === -1 ? preferred.length : li;
    return lang * 2 + (t.kind === "asr" ? 1 : 0);
  };
  return [...tracks].sort((a, b) => score(a) - score(b))[0];
}

/** baseUrl に json3 形式を指定した URL */
export function json3Url(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.searchParams.set("fmt", "json3");
  return u.toString();
}

interface Json3 { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] }[] }

/** json3 → Cue[]。改行・空要素を除く */
export function parseJson3(json: unknown): Cue[] {
  const ev = (json as Json3).events ?? [];
  const cues: Cue[] = [];
  for (const e of ev) {
    if (!e.segs || e.tStartMs == null) continue;
    const text = e.segs.map((s) => s.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    cues.push({ start: e.tStartMs / 1000, dur: (e.dDurationMs ?? 0) / 1000, text });
  }
  return cues;
}

/** watch ページ HTML から captionTracks を抜く（サーバー/CLI 用。壊れやすいので拡張機能では使わない） */
export function extractCaptionTracksFromHtml(html: string): CaptionTrack[] {
  const m = /"captionTracks":(\[.*?\])(?=,")/s.exec(html);
  if (!m?.[1]) return [];
  try {
    return JSON.parse(m[1]) as CaptionTrack[];
  } catch {
    return [];
  }
}

export function extractVideoId(input: string): string | null {
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.exec(input) ?? /^([A-Za-z0-9_-]{11})$/.exec(input);
  return m?.[1] ?? null;
}

/** srv3（XML）→ Cue[]。プレイヤーが json3 以外の形式で字幕を取ったときの保険。DOMParser を使わない（core は DOM 非依存） */
export function parseSrv3(xml: string): Cue[] {
  const cues: Cue[] = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? "", inner = m[2] ?? "";
    const t = /\bt="(\d+)"/.exec(attrs)?.[1];
    if (t == null) continue;
    const d = /\bd="(\d+)"/.exec(attrs)?.[1] ?? "0";
    const text = decodeEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    cues.push({ start: Number(t) / 1000, dur: Number(d) / 1000, text });
  }
  return cues;
}

/** timedtext の応答本文（json3 か srv3）を判別してパース。空や未知の形式は [] */
export function parseTimedtext(body: string): Cue[] {
  const s = body.trim();
  if (s.startsWith("{")) {
    try { return parseJson3(JSON.parse(s)); } catch { return []; }
  }
  if (s.startsWith("<")) return parseSrv3(s);
  return [];
}

interface TranscriptSegmentRenderer {
  startMs?: string | number;
  endMs?: string | number;
  snippet?: { runs?: { text?: string }[]; simpleText?: string };
}

/** youtubei/v1/get_transcript（YouTube 純正「文字起こしを表示」）の応答 → Cue[]。transcriptSegmentRenderer を再帰的に拾う */
export function parseTranscriptResponse(json: unknown): Cue[] {
  const cues: Cue[] = [];
  const walk = (o: unknown, depth: number) => {
    if (!o || typeof o !== "object" || depth > 40) return;
    const r = (o as { transcriptSegmentRenderer?: TranscriptSegmentRenderer }).transcriptSegmentRenderer;
    if (r) {
      const start = Number(r.startMs), end = Number(r.endMs);
      const text = (r.snippet?.runs?.map((x) => x.text ?? "").join("") ?? r.snippet?.simpleText ?? "").replace(/\s+/g, " ").trim();
      if (Number.isFinite(start) && text) cues.push({ start: start / 1000, dur: Number.isFinite(end) ? Math.max(0, end - start) / 1000 : 0, text });
      return;
    }
    for (const v of Object.values(o as Record<string, unknown>)) walk(v, depth + 1);
  };
  walk(json, 0);
  return cues.sort((a, b) => a.start - b.start);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
