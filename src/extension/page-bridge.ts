// MAIN world で動く橋。YouTube のページ変数・プレイヤー API に触る唯一の場所（content.ts は isolated world なので触れない）。
// content.ts から postMessage で「字幕をくれ」と頼まれ、次の順に試して返す：
//  0. プレイヤーが既に取った timedtext 応答が横取り済みならそれ（字幕 ON で視聴中のとき。副作用なし）
//  1. getPlayerResponse().captions の baseUrl を json3 で fetch（2025 年以降、pot トークン無しだと 200 で本文が空になることがある）
//  2. YouTube 純正「文字起こしを表示」と同じ youtubei/v1/get_transcript（副作用なし）
//  3. プレイヤーに字幕トラックを読ませ、その timedtext 応答を横取り（字幕が一瞬 ON になる。元が OFF なら戻す）
// 横取りのため document_start で fetch / XHR を包む。timedtext 以外には触らない。
import { json3Url, parseTimedtext, parseTranscriptResponse, pickTrack, type CaptionTrack, type Cue } from "../core";

interface PlayerEl extends HTMLElement {
  getPlayerResponse?: () => any;
  loadModule?: (m: string) => void;
  setOption?: (m: string, k: string, v: unknown) => void;
  toggleSubtitles?: () => void;
}
interface Captured { url: string; body: string; at: number }
type TranscriptReply =
  | { ok: true; meta: { videoId: string; title?: string; channel?: string; duration?: number }; lang: string; auto: boolean; cues: Cue[]; source: string }
  | { ok: false; error: string };

// ---------- timedtext の横取り（document_start） ----------
const captured: Captured[] = [];
const waiters = new Set<(c: Captured) => void>();
const isTimedtext = (url: string) => url.includes("/api/timedtext");

function noteTimedtext(url: string, body: string) {
  if (!body) return;
  const c = { url, body, at: Date.now() };
  captured.push(c);
  if (captured.length > 8) captured.shift();
  waiters.forEach((w) => w(c));
}

const origFetch = window.fetch;
window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const p = origFetch.call(this, input, init);
  if (isTimedtext(url)) p.then((res) => res.clone().text().then((t) => noteTimedtext(url, t)).catch(() => {})).catch(() => {});
  return p;
};
const origOpen = XMLHttpRequest.prototype.open;
(XMLHttpRequest.prototype as any).open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  const u = String(url);
  if (isTimedtext(u)) {
    this.addEventListener("load", () => {
      try {
        const body = this.responseType === "" || this.responseType === "text" ? this.responseText : typeof this.response === "string" ? this.response : JSON.stringify(this.response);
        noteTimedtext(u, body);
      } catch { /* 読めない responseType は無視 */ }
    });
  }
  return (origOpen as any).call(this, method, url, ...rest);
};

function capturedFor(videoId: string, since = 0): { c: Captured; lang: string; auto: boolean; cues: Cue[] } | null {
  for (let i = captured.length - 1; i >= 0; i--) {
    const c = captured[i]!;
    if (c.at < since) continue;
    let u: URL;
    try { u = new URL(c.url, location.href); } catch { continue; }
    if (u.searchParams.get("v") !== videoId || u.searchParams.get("tlang")) continue; // 翻訳字幕は対象外
    const cues = parseTimedtext(c.body);
    if (cues.length === 0) continue;
    return { c, lang: u.searchParams.get("lang") ?? "", auto: u.searchParams.get("kind") === "asr", cues };
  }
  return null;
}

// ---------- 1. 直接 fetch ----------
async function viaDirect(track: CaptionTrack): Promise<Cue[]> {
  try {
    const res = await origFetch(json3Url(track.baseUrl), { credentials: "include" });
    return res.ok ? parseTimedtext(await res.text()) : [];
  } catch { return []; }
}

// ---------- 2. get_transcript ----------
function findTranscriptParams(videoId: string): string | null {
  const roots: unknown[] = [
    (document.querySelector("ytd-watch-flexy") as any)?.data,
    (document.querySelector("ytd-app") as any)?.data?.response,
    (window as any).ytInitialData,
  ];
  const walk = (o: unknown, depth: number): string | null => {
    if (!o || typeof o !== "object" || depth > 30) return null;
    const p = (o as any).getTranscriptEndpoint?.params;
    if (typeof p === "string") return p;
    for (const v of Object.values(o as Record<string, unknown>)) { const r = walk(v, depth + 1); if (r) return r; }
    return null;
  };
  for (const r of roots) {
    if (!r) continue;
    const vid = (r as any).currentVideoEndpoint?.watchEndpoint?.videoId;
    if (vid && vid !== videoId) continue; // 前の動画のデータ
    const p = walk((r as any).engagementPanels, 0) ?? walk(r, 0);
    if (p) return p;
  }
  return null;
}
async function viaGetTranscript(videoId: string): Promise<Cue[]> {
  try {
    const params = findTranscriptParams(videoId);
    const ctx = (window as any).ytcfg?.get?.("INNERTUBE_CONTEXT");
    if (!params || !ctx) return [];
    const res = await origFetch("/youtubei/v1/get_transcript?prettyPrint=false", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json", "x-youtube-client-name": "1", "x-youtube-client-version": String(ctx.client?.clientVersion ?? "") },
      body: JSON.stringify({ context: ctx, params }),
    });
    return res.ok ? parseTranscriptResponse(await res.json()) : [];
  } catch { return []; }
}

// ---------- 3. プレイヤーに読ませて横取り ----------
const subtitlesOn = () => document.querySelector(".ytp-subtitles-button")?.getAttribute("aria-pressed") === "true";
async function viaPlayer(player: PlayerEl, videoId: string, track: CaptionTrack): Promise<ReturnType<typeof capturedFor>> {
  const wasOn = subtitlesOn();
  const since = Date.now();
  const wait = new Promise<Captured | null>((resolve) => {
    const w = (c: Captured) => { if (c.url.includes(`v=${videoId}`)) { waiters.delete(w); resolve(c); } };
    waiters.add(w);
    setTimeout(() => { waiters.delete(w); resolve(null); }, 6000);
  });
  try {
    player.loadModule?.("captions");
    const opt: Record<string, string> = { languageCode: track.languageCode };
    if (track.kind) opt.kind = track.kind;
    if (track.vssId) opt.vss_id = track.vssId;
    player.setOption?.("captions", "track", opt);
  } catch { /* API が無い・変わった */ }
  await wait;
  if (!wasOn) {
    try { player.setOption?.("captions", "track", {}); } catch { /* noop */ }
    if (subtitlesOn()) { try { player.toggleSubtitles?.(); } catch { /* noop */ } }
  }
  return capturedFor(videoId, since);
}

// ---------- 入口 ----------
async function getTranscript(preferred: string[]): Promise<TranscriptReply> {
  const player = document.getElementById("movie_player") as PlayerEl | null;
  const pr = player?.getPlayerResponse?.();
  if (!player || !pr) throw new Error("player not ready");
  const vd = pr.videoDetails ?? {};
  const videoId: string = vd.videoId ?? new URL(location.href).searchParams.get("v") ?? "";
  const meta = { videoId, title: vd.title as string | undefined, channel: vd.author as string | undefined, duration: Number(vd.lengthSeconds) || undefined };
  const tracks: CaptionTrack[] = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const track = pickTrack(tracks, preferred);
  if (!track) throw new Error("This video has no captions");
  const ok = (source: string, lang: string, auto: boolean, cues: Cue[]): TranscriptReply => ({ ok: true, meta, lang, auto, cues, source });

  const pre = capturedFor(videoId);
  if (pre) return ok("captured", pre.lang || track.languageCode, pre.auto, pre.cues);
  let cues = await viaDirect(track);
  if (cues.length) return ok("direct", track.languageCode, track.kind === "asr", cues);
  cues = await viaGetTranscript(videoId);
  if (cues.length) return ok("transcript", track.languageCode, track.kind === "asr", cues);
  const cap = await viaPlayer(player, videoId, track);
  if (cap) return ok("player", cap.lang || track.languageCode, cap.auto, cap.cues);
  throw new Error("Couldn't read the captions");
}

window.addEventListener("message", async (e: MessageEvent) => {
  if (e.source !== window || e.data?.type !== "jevseek:req-transcript") return;
  const id = e.data.id;
  let reply: TranscriptReply;
  try { reply = await getTranscript(Array.isArray(e.data.preferred) ? e.data.preferred : ["ja", "en"]); }
  catch (err) { reply = { ok: false, error: String((err as Error)?.message ?? err) }; }
  window.postMessage({ type: "jevseek:transcript", id, ...reply }, "*");
});
