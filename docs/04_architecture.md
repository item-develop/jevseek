# 04. 構成

```
YouTube watch ページ
 ├─ page-bridge.js (MAIN world)   getPlayerResponse() → captionTracks → 字幕本文（3 段構え、下記）→ postMessage
 └─ content.js (isolated)         cues → chunk → パネル & ヒート描画。サーバーへは background 経由
                                   │  chrome.runtime.connect（port。切断 = 中断）
                                   ▼
 background.js (service worker)   POST /api/seek を localhost に中継。⌘⇧F のコマンドも受ける
                                   │
                                   ▼
                         localhost:8787 (Hono)         ← AI_GATEWAY_API_KEY はここだけ
                          POST /api/seek  ─▶  src/jev/evaluate.ts  ─▶  AI Gateway  ─▶  Jev
                          GET  /api/transcript?v=   （CLI 用。サーバー側で字幕を取る）
                                   ▲
 CLI  src/cli/seek.ts / eval.ts ───┘   （サーバーを経由せず evaluate.ts を直接呼ぶ）
```

## ディレクトリ

```
src/core/        DOM/Node 非依存。字幕パース、チャンク、質問生成、スコアリング、型
src/jev/         evaluate.ts（ai の experimental_evaluate。唯一の依存点）、Mock、記録、環境設定
src/server/      Hono。/api/seek, /api/transcript, /api/health
src/cli/         seek（1 クエリ）、eval（評価セット）
src/extension/   manifest, page-bridge（MAIN world。字幕取得）, content（UI）, background（サーバー中継）, styles
scripts/         拡張機能のビルド（esbuild → dist/extension）
fixtures/        合成字幕と評価セット。実動画の字幕を追加してよい（yt-dlp の json3 → Transcript 形式）
tests/           vitest（core の純粋ロジック、seek パイプライン、Mock モデルでの jev 経路）
recordings/      JSONL（SEEK_RECORD=1）
```

依存の向き：`extension`/`server`/`cli` → `jev` → `core`。`core` は何にも依存しない。

## 字幕の取り方（2 経路）

| 経路 | 使う所 | 仕組み | 壊れやすさ |
| --- | --- | --- | --- |
| ページ内 | 拡張機能 | MAIN world でプレイヤー API から `captionTracks` を取り、字幕本文は下の 3 段構えで取る | 低〜中（プレイヤー API の変更に依存） |
| サーバー側 | CLI / eval | watch ページ HTML から正規表現で `captionTracks` → json3 | 中（YouTube 側の変更、timedtext のブロック） |

### ページ内の 3 段構え（`page-bridge.ts`）

2025 年以降、`captionTracks[].baseUrl` をそのまま fetch すると **200 で本文が空**になることがある（プレイヤー自身は `pot` トークンを付けて取っている）。
そのため順に試す。どれも同じ `Cue[]` に落とす（`parseTimedtext` / `parseTranscriptResponse`）。

| 順 | 経路 | 副作用 |
| --- | --- | --- |
| 0 | プレイヤーが既に取った timedtext 応答（document_start で fetch / XHR を包んで横取り済み） | なし |
| 1 | `baseUrl&fmt=json3` を直接 fetch | なし |
| 2 | 純正「文字起こしを表示」と同じ `youtubei/v1/get_transcript`（params は `ytd-watch-flexy` / `ytd-app` / `ytInitialData` から） | なし |
| 3 | `player.loadModule("captions")` + `setOption("captions","track",…)` で読ませ、その応答を横取り。元が OFF なら戻す | 字幕が一瞬出る |

全部空なら「字幕を読めませんでした」。字幕トラック自体が無ければ「字幕がない動画です」。

サーバー側が壊れたら `yt-dlp --skip-download --write-auto-sub --sub-format json3 <url>` で取った JSON を `Transcript` 形式に変換して fixtures に置き、`--fixture` で回す。

## リクエストの流れ（拡張機能）

1. `yt-navigate-finish` でキャッシュを捨て、1.5 秒後に字幕を先読み
2. 入力 → 220ms デバウンス → 前回の port を切って中断（background 側で fetch も abort）→ `POST /api/seek { query, meta, segments }`
3. 応答 → ヒット一覧、ヒート canvas を描画、メタ欄にレイテンシ
4. 行クリック / Enter → `video.currentTime = start - 1.5; play()`

サーバーは YouTube を見に行かない（拡張機能が segments を送る）。字幕のキャッシュは拡張機能側（videoId 単位、タブ内）。
content script が localhost を直接 fetch しないのは、youtube.com のオリジンからだと CORS のプリフライトと Chrome のローカルネットワークアクセス許可に引っかかるため。
`host_permissions` を持つ service worker が代わりに叩く。

## 設定

`.env` を読むのはサーバーと CLI。拡張機能は `SERVER = http://localhost:8787` を定数で持つ（`background.ts` と `content.ts`、v1）。窓の設定（25s/140 文字）は拡張機能側の定数とサーバーの `.env` を揃える。
