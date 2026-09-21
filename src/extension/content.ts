// isolated world の content script。UI とサーバー通信。デザインは docs/02_ui.md に従う。
// - 字幕はページ内で取る（page-bridge.ts に頼む）。サーバーには segments を送るだけ
// - サーバーへは service worker（background.ts）経由。youtube.com から localhost を直接叩く CORS / ローカルネットワーク制限を避ける
// - 入力に追従（220ms デバウンス、前のリクエストは port を切って中断）
// - シークバーに熱量を重ねる。上位ヒットは一覧からクリック/Enter で飛ぶ
import { chunkCues, fmtTime, type Cue, type Segment, type SeekResponse, type VideoMeta } from "../core";

const SERVER = "http://localhost:8787";
const WINDOW = { windowSec: 25, windowChars: 140 }; // サーバー設定（.env）と揃える

interface Cache { videoId: string; meta: VideoMeta; segments: Segment[]; duration: number }
interface ServerReply { ok: boolean; status: number; data: (SeekResponse & { error?: string }) | { error?: string } }

let cache: Cache | null = null;
let loading: Promise<Cache> | null = null;
let panel: HTMLDivElement | null = null;
let heatCanvas: HTMLCanvasElement | null = null;
let lastRes: SeekResponse | null = null;
let selected = -1;
let inflight: AbortController | null = null;
let debounceT: number | undefined;
let navGen = 0;

const currentVideoId = () => new URL(location.href).searchParams.get("v") ?? "";

// ---------- 字幕（page-bridge に頼む） ----------
function requestTranscript(): Promise<{ meta: VideoMeta; cues: Cue[]; lang: string; auto: boolean; source: string }> {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const timer = window.setTimeout(() => { window.removeEventListener("message", onMsg); reject(new Error("Loading captions timed out")); }, 15000);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.data?.type !== "jevseek:transcript" || e.data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (e.data.ok) resolve({ meta: e.data.meta ?? {}, cues: e.data.cues ?? [], lang: e.data.lang ?? "", auto: Boolean(e.data.auto), source: e.data.source ?? "" });
      else reject(new Error(e.data.error ?? "Couldn't read the captions"));
    };
    window.addEventListener("message", onMsg);
    const preferred = [...new Set([navigator.language.slice(0, 2), "ja", "en"])];
    window.postMessage({ type: "jevseek:req-transcript", id, preferred }, "*");
  });
}

async function loadTranscript(): Promise<Cache> {
  const videoId = currentVideoId();
  if (cache?.videoId === videoId) return cache;
  if (loading) return loading;
  loading = (async () => {
    const t = await requestTranscript();
    if (t.cues.length === 0) throw new Error("Couldn't read the captions");
    const segments = chunkCues(t.cues, WINDOW);
    const video = document.querySelector("video");
    const last = t.cues[t.cues.length - 1]!;
    const duration = (video && Number.isFinite(video.duration) && video.duration) || t.meta.duration || last.start + last.dur;
    cache = { videoId, meta: { ...t.meta, videoId, lang: t.lang, auto: t.auto }, segments, duration };
    console.debug(`[jevseek] transcript: ${t.cues.length} cues → ${segments.length} segments (${t.source}, ${t.lang}${t.auto ? " asr" : ""})`);
    return cache;
  })().finally(() => { loading = null; });
  return loading;
}

// ---------- サーバー通信（service worker 経由。無ければ直接） ----------
function callServer(path: string, body: unknown, signal: AbortSignal): Promise<ServerReply> {
  const rt = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
  if (!rt?.connect) {
    return fetch(SERVER + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal })
      .then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json().catch(() => ({ error: `HTTP ${r.status}` })) }));
  }
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try { port = rt.connect({ name: "jevseek:server" }); }
    catch { reject(new Error("The extension was updated. Reload this page")); return; }
    let done = false;
    port.onMessage.addListener((m: ServerReply) => { done = true; resolve(m); port.disconnect(); });
    port.onDisconnect.addListener(() => { if (!done) { done = true; reject(new Error(rt.lastError?.message ?? "Lost connection to the extension. Reload this page")); } });
    signal.addEventListener("abort", () => { if (!done) { done = true; port.disconnect(); reject(new DOMException("aborted", "AbortError")); } });
    port.postMessage({ path, body });
  });
}

// ---------- パネル ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function ensurePanel(): HTMLDivElement {
  if (panel?.isConnected) return panel;
  const player = document.getElementById("movie_player");
  if (!player) throw new Error("player not found");
  // innerHTML を使わない（YouTube は Trusted Types を強制しており、文字列代入は環境によって例外になる）
  panel = el("div", "jevseek");
  const bar = el("div", "jevseek-bar");
  const input = el("input", "jevseek-input");
  input.type = "text"; input.spellcheck = false; input.autocomplete = "off";
  input.placeholder = "Where in this video? e.g. where they mention the price";
  const brand = el("span", "jevseek-brand"); brand.textContent = "jevSeek";
  bar.append(brand, input, el("span", "jevseek-meta"));
  panel.append(bar, el("ol", "jevseek-hits"), el("div", "jevseek-status"));
  player.appendChild(panel);

  input.addEventListener("input", () => scheduleQuery(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); closePanel(); return; }
    if (!lastRes) return;
    if (e.key === "ArrowDown") { e.preventDefault(); select(Math.min(lastRes.hits.length - 1, selected + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); select(Math.max(0, selected - 1)); }
    if (e.key === "Enter") { e.preventDefault(); const h = lastRes.hits[Math.max(0, selected)]; if (h) seekTo(h.start); }
  });
  // YouTube のショートカット（k, f, j, l, 数字キー…）と再生/全画面トグルに食われないように、パネル内のイベントはここで止める
  for (const type of ["keydown", "keyup", "keypress", "mousedown", "mouseup", "click", "dblclick", "contextmenu"] as const) {
    panel.addEventListener(type, (e) => e.stopPropagation());
  }
  return panel;
}

function openPanel() {
  const p = ensurePanel();
  p.classList.add("is-open");
  const input = p.querySelector<HTMLInputElement>(".jevseek-input")!;
  input.focus(); input.select();
  if (cache) { setStatus(transcriptStatus(cache)); return; }
  setStatus("Loading captions…");
  loadTranscript().then((c) => { if (panel?.classList.contains("is-open")) setStatus(transcriptStatus(c)); }).catch((e) => setStatus(String(e.message ?? e), true));
}
const transcriptStatus = (c: Cache) => `${c.segments.length} segments · ${c.meta.auto ? "auto captions" : "captions"} ${c.meta.lang ?? ""}`.trim();
function closePanel() {
  panel?.classList.remove("is-open");
  (document.activeElement as HTMLElement | null)?.blur();
}
function togglePanel() {
  if (location.pathname !== "/watch") return;
  panel?.classList.contains("is-open") ? closePanel() : openPanel();
}

function setStatus(text: string, isError = false) {
  const el = panel?.querySelector<HTMLDivElement>(".jevseek-status");
  if (!el) return;
  el.textContent = text; el.classList.toggle("is-error", isError);
}
function setMeta(text: string) {
  const el = panel?.querySelector<HTMLSpanElement>(".jevseek-meta");
  if (el) el.textContent = text;
}

// ---------- 検索 ----------
function scheduleQuery(q: string) {
  window.clearTimeout(debounceT);
  const query = q.trim();
  if (!query) { inflight?.abort(); lastRes = null; selected = -1; renderHits(); drawHeat(); setMeta(""); setStatus(cache ? transcriptStatus(cache) : ""); return; }
  debounceT = window.setTimeout(() => runQuery(query), 220);
}

async function runQuery(query: string) {
  inflight?.abort();
  const ac = new AbortController(); inflight = ac;
  setMeta("…");
  try {
    const c = await loadTranscript();
    if (ac.signal.aborted) return;
    const reply = await callServer("/api/seek", { query, meta: c.meta, segments: c.segments }, ac.signal);
    if (ac.signal.aborted) return;
    const data = reply.data as SeekResponse & { error?: string };
    if (!reply.ok || data.error) throw new Error(data.error ?? `HTTP ${reply.status}`);
    lastRes = data; selected = data.hits.length ? 0 : -1;
    renderHits(); drawHeat();
    setMeta(`${(data.latencyMs / 1000).toFixed(1)}s${data.backend === "mock" ? " · mock" : ""}`);
    setStatus(data.hits.length === 0 ? (data.anyP < 0.3 ? "This video doesn't seem to talk about that" : "No clear moment found") : "");
  } catch (e) {
    if (ac.signal.aborted) return;
    setMeta("");
    setStatus(/Failed to fetch/.test(String(e)) ? "Can't reach the server (npm run dev)" : String((e as Error).message ?? e), true);
  }
}

function renderHits() {
  const ol = panel?.querySelector<HTMLOListElement>(".jevseek-hits");
  if (!ol) return;
  ol.replaceChildren();
  for (const [i, h] of (lastRes?.hits ?? []).entries()) {
    const li = el("li", "jevseek-hit" + (i === selected ? " is-selected" : ""));
    const time = el("span", "jevseek-time"); time.textContent = fmtTime(h.start);
    const text = el("span", "jevseek-text"); text.textContent = h.text;
    const p = el("span", "jevseek-p"); const fill = el("i"); fill.style.width = `${Math.round(h.p * 100)}%`; p.appendChild(fill);
    li.append(time, text, p);
    li.addEventListener("click", () => { select(i); seekTo(h.start); });
    li.addEventListener("mouseenter", () => highlightHeat(i));
    li.addEventListener("mouseleave", () => highlightHeat(-1));
    ol.appendChild(li);
  }
}
function select(i: number) {
  selected = i;
  panel?.querySelectorAll(".jevseek-hit").forEach((el, j) => el.classList.toggle("is-selected", j === i));
  drawHeat();
}
function seekTo(sec: number) {
  const v = document.querySelector("video");
  if (!v) return;
  v.currentTime = Math.max(0, sec - 1.5); // 少し手前から
  v.play().catch(() => {});
}

// ---------- シークバーの熱量 ----------
function ensureHeatCanvas(): HTMLCanvasElement | null {
  const bar = document.querySelector<HTMLElement>(".ytp-progress-bar");
  if (!bar) return null;
  if (heatCanvas?.isConnected && heatCanvas.parentElement === bar) return heatCanvas;
  heatCanvas?.remove();
  heatCanvas = document.createElement("canvas");
  heatCanvas.className = "jevseek-heat";
  bar.appendChild(heatCanvas);
  new ResizeObserver(() => drawHeat()).observe(bar);
  return heatCanvas;
}

let highlighted = -1;
function highlightHeat(i: number) { highlighted = i; drawHeat(); }

function drawHeat() {
  const cv = ensureHeatCanvas();
  if (!cv || !cache) return;
  const w = cv.parentElement!.clientWidth, h = 16, dpr = window.devicePixelRatio || 1;
  if (w === 0) return;
  cv.width = Math.floor(w * dpr); cv.height = h * dpr; cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  const ctx = cv.getContext("2d")!; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
  if (!lastRes) { cv.classList.remove("is-visible"); return; }
  cv.classList.add("is-visible");
  const dur = cache.duration || 1;
  const rgb = getComputedStyle(cv).getPropertyValue("--jevseek-accent-rgb").trim() || "255, 255, 255"; // 色は styles.css の 1 行で決める
  for (const pt of lastRes.heat) {
    if (pt.p < 0.12) continue;
    const x = (pt.start / dur) * w, x2 = (pt.end / dur) * w;
    const barH = 3 + pt.p * (h - 3);
    ctx.fillStyle = `rgba(${rgb},${0.25 + 0.7 * pt.p})`;
    ctx.fillRect(x, h - barH, Math.max(1.5, x2 - x - 0.5), barH);
  }
  const focus = lastRes.hits[highlighted >= 0 ? highlighted : selected];
  if (focus) {
    const x = (focus.start / dur) * w;
    ctx.fillStyle = "#fff"; ctx.fillRect(Math.round(x) - 1, 0, 2, h);
  }
}

// ---------- 起動 ----------
function waitFor(selector: string, timeoutMs: number): Promise<Element | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      if (Date.now() - t0 > timeoutMs) return resolve(null);
      window.setTimeout(tick, 250);
    };
    tick();
  });
}

function onNavigate() {
  const gen = ++navGen;
  inflight?.abort();
  cache = null; lastRes = null; selected = -1;
  heatCanvas?.remove(); heatCanvas = null;
  panel?.remove(); panel = null;
  if (location.pathname !== "/watch") return;
  waitFor("#movie_player", 15000).then((player) => {
    if (!player || gen !== navGen) return;
    ensureTrigger();
    window.setTimeout(() => { if (gen === navGen) loadTranscript().catch(() => {}); }, 1500); // 先読み。失敗しても黙る（開いたときに再試行）
  });
}
function ensureTrigger() {
  const player = document.getElementById("movie_player");
  if (!player || player.querySelector(".jevseek-trigger")) return;
  const b = document.createElement("button");
  b.className = "jevseek-trigger"; b.type = "button"; b.textContent = "Find";
  b.title = "jevSeek (⌘⇧F / Ctrl+Shift+F)";
  for (const type of ["mousedown", "mouseup", "dblclick"] as const) b.addEventListener(type, (e) => e.stopPropagation());
  b.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
  player.appendChild(b);
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f" && location.pathname === "/watch") { e.preventDefault(); e.stopPropagation(); togglePanel(); }
}, true);
try {
  (globalThis as { chrome?: typeof chrome }).chrome?.runtime?.onMessage?.addListener((msg: { type?: string }) => { if (msg?.type === "jevseek:toggle") togglePanel(); });
} catch { /* 拡張機能の外で読み込まれたとき */ }
document.addEventListener("yt-navigate-finish", onNavigate);
onNavigate();
