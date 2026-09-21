# CLAUDE.md — jevSeek

「動画に Ctrl+F を」。YouTube の字幕を 25 秒のセグメントに切り、Jev（TypeSafe AI, Vercel AI Gateway 経由）に
「このセグメントは query の話をしているか」を全セグメントぶん 1 リクエストで聞き、秒数の候補とシークバーの熱量を出す Chrome 拡張。
仕様は `docs/`。これはスターターで、**コアの配線は動いている**（typecheck / test / CLI / eval / 拡張ビルドが通る）。

## 読む順

`docs/01_product.md` → `03_jev_query_design.md` → `04_architecture.md` → `02_ui.md` → `05_verification.md`

## コマンド

```
npm i
cp .env.example .env            # AI_GATEWAY_API_KEY を入れる。無ければ Mock
npm run dev                     # サーバー :8787（拡張機能はここに投げる）
npm run build:ext               # dist/extension（chrome://extensions で読み込む）
npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "値段を言ったところ"   # ブラウザなしで 1 クエリ
npm run seek -- --url <youtube url> --q "…"                                          # 実動画（サーバー側取得）
npm run eval                    # 評価セット（hit@1 / hit@3）
npm run test && npm run typecheck
```

## 守ること

1. **`ai` の import は `src/jev/evaluate.ts` だけ。** API 形が変わっても直す場所を 1 つにする
2. **`src/core` は DOM / Node 非依存。** 拡張機能・サーバー・CLI の全部から使う
3. **セグメント 1 個 = 質問 1 本、全部 1 リクエスト。** 質問を減らして節約しない。往復を減らす（`batchSegments`）
4. **質問文に閾値・例外規定・「該当なし」を書かない。** 閾値は `SeekConfig`、逃げ道は別の `any` 質問（docs/03）
5. **キーは拡張機能に入れない。** 拡張機能は localhost のサーバーにしか話さない
6. **UI は docs/02 のトークンだけで作る。** 色を足さない、アイコンを足さない、動きを足さない
7. **Mock は配線確認用。** Jev の「意味で当てる」挙動を Mock で再現しようとしない
8. **精度の変更は `npm run eval` で測ってから。** 質問文・窓・閾値を変えたら before/after を記録（`SEEK_RECORD=1`）

## 今の状態

| 部分 | 状態 |
| --- | --- |
| core（字幕パース、チャンク、質問、スコア） | 実装済み・テストあり |
| jev/evaluate（AI Gateway 経由、Mock、分割並列） | 実装済み。実キーで動作確認済み（モデル ID は `typesafe-ai/jev`）。`sample_ja` の eval は hit@1 6/6、1 クエリ約 0.5 秒・7K トークン（2026-09-21） |
| server（/api/seek, /api/transcript, /api/health） | 実装済み |
| cli（seek, eval） | 実装済み。Jev で eval が回る |
| extension（bridge, content, background, styles） | 実装済み・ビルド可。UI・キー操作・ヒート描画・サーバー往復は実 YouTube ページで確認済み（Mock）。**字幕取得（3 段構え、docs/04）は普段の Chrome で要確認** |

## 最初にやること（順に）

1. ~~`.env` に AI Gateway のキーを入れ、Jev で当たるか見る~~ 済み（6/6）。boolean と score の比較（`SEEK_QUESTION_TYPE=score` で `npm run eval`）はまだ
2. `.env` を変えたら `npm run dev` を再起動する（サーバーは起動時にしか読まない）
3. `npm run dev` と `npm run build:ext` で拡張機能を読み込み、docs/05 §7 のチェックリストを通す。壊れているのは YouTube の DOM（`.ytp-progress-bar`、`#movie_player`）や `getPlayerResponse` の変更、字幕 API の仕様変更（docs/04「3 段構え」）が原因のことが多い。コンソールの `[jevseek] transcript:` 行でどの経路が効いたか分かる
4. 実動画の字幕を 3 本 fixtures に足し、評価セットを書く
5. デモ動画（docs/01「体験」）を撮る

## 仕様が足りないとき

`docs/DECISIONS.md` に 1 行書いて進む。UI の迷いは docs/02 の「原則」に寄せる。Jev の聞き方の迷いは docs/03 と mizchi 氏の practice.md に寄せる。

## やらないこと

Whisper、複数動画、ストア配布、認証、要約生成、React やビルド構成の追加（esbuild + tsx で足りる）。
