# jevSeek

> 動画に Ctrl+F を。「値段を言ったところ」「話が脱線してるところ」と打つと、その秒数へ。

YouTube の字幕をセグメントに切り、Jev（TypeSafe AI）に全セグメント分の判定を 1 リクエストで聞き、
候補の秒数とシークバー上の熱量を出す Chrome 拡張。Vercel AI Gateway（`typesafe-ai/jev`）経由で動く。

## 動かす

```
npm i
cp .env.example .env         # AI_GATEWAY_API_KEY を入れる（無ければキーワード一致の Mock で動く）
npm run dev                  # localhost:8787
npm run build:ext            # dist/extension → chrome://extensions で「パッケージ化されていない拡張機能を読み込む」
```

YouTube の動画で ⌘⇧F（Ctrl+Shift+F）。

## ブラウザなしで検証

```
npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "ゲストが困ってるところ"
npm run seek -- --url "https://www.youtube.com/watch?v=…" --q "値段を言ったところ"
npm run eval                 # fixtures/eval の評価セットで hit@1 / hit@3
```

## 構成

`docs/` に仕様（プロダクト / UI / Jev への聞き方 / 構成 / 検証）。実装は `src/core`（純粋ロジック）→ `src/jev`（Jev 呼び出し）→ `server` / `cli` / `extension`。
Claude Code で進める前提の指示は `CLAUDE.md`。

## 状態

コアの配線・テスト・CLI・拡張ビルドは通っている。拡張機能の UI・キー操作・ヒート描画・サーバー往復は実 YouTube ページで確認済み（Mock）。
実キーでの精度は未確認（`CLAUDE.md` の「最初にやること」）。
