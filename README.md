# jevSeek

> **Ctrl+F for videos.** Type "where they mention the price" or "where the conversation goes off-topic" on a YouTube video, and jump to that second.

jevSeek is a Chrome extension. It splits the video's captions into ~25-second segments, asks [Jev](https://typesafe.ai) (TypeSafe AI, via [Vercel AI Gateway](https://vercel.com/ai-gateway)) *"does this segment talk about the query?"* for **every segment in a single request**, and draws the answers as a heat strip on the seek bar with the top moments listed in a panel. Results update as you type.

It is a search, not a chat: Jev never generates text, it only scores. One query over a one-hour video costs about a tenth of a cent and returns in about half a second.

日本語の説明は[下](#日本語)にあります。

## How it works

```
YouTube watch page
 ├─ page-bridge.js (MAIN world)   reads caption tracks from the player, fetches the transcript
 └─ content.js (isolated)         chunk → panel + heat strip; talks to the server through the service worker
                                   │
 background.js (service worker)   relays POST /api/seek to localhost
                                   ▼
 localhost:8787 (Hono)            holds AI_GATEWAY_API_KEY; batches segments; calls Jev
                                   ▼
 Vercel AI Gateway → typesafe-ai/jev
```

- One boolean question per segment, all in one request (split and run in parallel only when a video is very long). A separate "does this video talk about it at all?" question decides between *"No clear moment found"* and *"This video doesn't seem to talk about that"*.
- The extension never holds the API key. It only talks to the local server.
- Captions are read inside the page, the way YouTube's own player does, so the server never touches YouTube.

Design notes live in [`docs/`](docs/) (Japanese): product, UI, how to ask Jev, architecture, verification.

## Requirements

- Node.js 20+
- Chrome 120+
- A Vercel AI Gateway API key (`typesafe-ai/jev` is available on the gateway). Without a key the server runs a keyword-matching mock so you can develop the UI.

## Setup

```sh
npm install
cp .env.example .env        # put your AI_GATEWAY_API_KEY in .env
npm run dev                 # local server on http://localhost:8787
npm run build:ext           # → dist/extension
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `dist/extension`.

## Use

Open any YouTube video that has captions (manual or auto-generated). Press **⌘⇧F** (Mac) / **Ctrl+Shift+F**, click the **Find** pill in the top-right corner of the player, or click the extension icon in the toolbar.

| Action | Result |
| --- | --- |
| Type | Searches 220 ms after you stop typing. The previous request is cancelled |
| ↑ / ↓ | Move between hits; a white marker follows on the seek bar |
| Enter / click | Jump to that moment (starts 1.5 s early) |
| Esc | Close |

The status line tells you what happened: `30 segments · auto captions en`, `No clear moment found`, `Can't reach the server (npm run dev)`, and so on. `mock` next to the latency means no API key is configured.

## Try it without a browser

```sh
npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "where the guest sounds unsure"
npm run seek -- --url "https://www.youtube.com/watch?v=…" --q "where they mention the price"   # server-side caption fetch; may be blocked by YouTube
npm run eval                 # hit@1 / hit@3 over fixtures/eval
npm test && npm run typecheck
```

`SEEK_RECORD=1` writes every Jev request and response to `recordings/*.jsonl` so you can compare question wordings before and after a change.

## Configuration (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | — | Vercel AI Gateway key. Empty → mock |
| `JEV_MODEL` | `typesafe-ai/jev` | Gateway model id |
| `SEEK_QUESTION_TYPE` | `boolean` | `boolean` (P(true) is the heat) or `score` (3 levels) |
| `SEEK_MAX_SEGMENTS_PER_REQUEST` | `120` | Split point for long videos |
| `SEEK_WINDOW_SEC` / `SEEK_WINDOW_CHARS` | `25` / `140` | Segment size (keep in sync with `src/extension/content.ts`) |
| `PORT` | `8787` | Server port (the extension expects 8787) |

## Layout

```
src/core/        pure logic, no DOM or Node: caption parsing, chunking, questions, scoring
src/jev/         the only place that imports `ai` (experimental_evaluate); mock; recording
src/server/      Hono: /api/seek, /api/transcript, /api/health
src/cli/         seek (one query), eval (evaluation set)
src/extension/   manifest, page-bridge (MAIN world), content (UI), background (relay), styles, icons
scripts/         extension build (esbuild), icon generation
fixtures/        synthetic transcript + evaluation set (add real ones)
tests/           vitest
```

## Privacy

The captions of the video you search and your query are sent to Vercel AI Gateway and on to TypeSafe AI. Nothing else leaves your machine, and the API key stays in `.env` on the local server.

## Status

Working end to end with a real key. On the bundled evaluation set, hit@1 is 6/6 including two predicate-style queries ("where the conversation goes off-topic", "where the guest sounds unsure"). Caption fetching has three fallbacks because YouTube changes its caption endpoints; if all three fail you get *"Couldn't read the captions"*. Not published on the Chrome Web Store; load it unpacked.

## Contributing

Issues and pull requests are welcome at [github.com/item-develop/jevseek](https://github.com/item-develop/jevseek). Before changing a question wording, window size, or threshold, run `npm run eval` before and after and put both numbers in the PR (see `docs/05_verification.md`). `CLAUDE.md` holds the working rules for the codebase and is written for [Claude Code](https://claude.com/claude-code), but the rules apply to humans too.

## License

[MIT](LICENSE)

---

## 日本語

**動画に Ctrl+F を。** YouTube の動画で「値段を言ったところ」「話が脱線してるところ」と打つと、その秒数の候補が出て、シークバーに山が立ちます。

字幕を約 25 秒のセグメントに切り、Jev（TypeSafe AI、Vercel AI Gateway 経由）に「このセグメントは query の話をしているか」を**全セグメントぶん 1 リクエスト**で聞きます。Jev は文章を生成せず判定だけを返すので、1 時間の動画でも 1 クエリ 0.5 秒前後、費用は 1 円未満です。

### 動かす

```sh
npm install
cp .env.example .env        # AI_GATEWAY_API_KEY を入れる（無ければキーワード一致の Mock）
npm run dev                 # localhost:8787
npm run build:ext           # dist/extension → chrome://extensions で「パッケージ化されていない拡張機能を読み込む」
```

YouTube の動画で ⌘⇧F（Ctrl+Shift+F）、プレイヤー右上の「Find」、またはツールバーのアイコン。

### ブラウザなしで検証

```sh
npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "ゲストが困ってるところ"
npm run eval                 # fixtures/eval の評価セットで hit@1 / hit@3
```

### 仕様

`docs/` にあります（プロダクト / UI / Jev への聞き方 / 構成 / 検証 / 決定記録）。質問文・窓・閾値を変えるときは `npm run eval` で前後を測ってください。
