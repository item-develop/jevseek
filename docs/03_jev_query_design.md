# 03. Jev への聞き方

参考：mizchi/jev-playground `docs/practice.md`、AI SDK `experimental_evaluate` ドキュメント、Vercel/Netlify の Jev 紹介。

## 1. 呼び出し

```ts
import { experimental_evaluate as evaluate } from "ai";  // ai >= 7.0.105
const result = await evaluate({
  model: "typesafe-ai/jev",   // 文字列は AI Gateway で解決（AI_GATEWAY_API_KEY）
  state,                             // 1 つの共有 state（オブジェクト）
  questions,                         // { id: { type, instructions, criteria } }
  maxRetries: 0,
});
result.answers.s12.probability       // boolean の P(true)
result.answers.s12.score             // score の期待値（0..levels-1）
result.providerMetadata?.typesafe?.confidence  // choice/score の確信度（boolean には無い）
result.usage.inputTokens
```

- 依存はこれだけ。`src/jev/evaluate.ts` の外で `ai` を import しない
- モデル ID を変える／自前プロバイダに切り替えるのは `JEV_MODEL` と `evaluatorFromEnv()` だけ

## 2. セグメント（state の単位）

- 字幕キューを **25 秒 or 140 文字** を超えたら区切る。文末で切れるならそこで（`chunkCues`）
- 重ねない。重ねると同じ発話が 2 セグメントに入ってヒートが二重に立つ
- 1 時間の動画で 120〜200 セグメント。日本語 1 セグメント ≈ 100〜140 トークン。質問 1 本 ≈ 50 トークン（文脈の注記を外して半分にした。eval は変わらず 6/6）

## 3. state と質問

```jsonc
// state
{ "task": "動画の字幕を時間順のセグメントに分けたもの。query が指す内容を話している箇所を探す。",
  "query": "値段を言ったところ",
  "video": { "title": "…", "channel": "…", "lang": "ja" },
  "segments": [ { "id": "s0", "t": "0:00-0:24", "text": "…" }, … ] }

// questions（セグメントごと）
"s12": { "type": "boolean",
         "instructions": "セグメント s12 は query の内容を話しているか。",
         "criteria": { "true": "話している", "false": "話していない" } }
// 別問い（逃げ道。choice に混ぜない）
"any": { "type": "boolean", "instructions": "この字幕全体の中に、query が指す内容を話している箇所が 1 つでもあるか。" }
```

### boolean と score
- 既定は **boolean**。P(true) がそのまま熱量になり、閾値が引きやすい
- **score**（`SEEK_QUESTION_TYPE=score`）は 3 段階「話していない／少し触れている／まさにその話」。期待値 ÷ 2 を熱量にする。「触れている」と「主題」を分けたいときに試す。practice.md の「順序のある結論は score で」に沿う
- どちらが良いかは `npm run eval` で決める（docs/05）

### 書き方の約束（practice.md より）
- 質問文に閾値・例外規定・「該当なし」を書かない
- 質問は全セグメントで同じ文面。違うのは id だけ
- コードが知っていること（時刻 `t`）は state に書く。質問文に書かない
- boolean の criteria は `{ true, false }` をネストする（トップレベルに置くと黙って無視される）

## 4. 分割と並列

- 上限はトークン（state と質問で概ね 32K）。`batchSegments` が **120 セグメント or 見積 20K トークン** で割り、`Promise.all` で並列
- 分割してもセグメントの答えは独立なので合成は単純結合。`any` は max
- 1 時間動画 = 1〜2 リクエスト、費用は入力 $0.042/1M トークン換算で **1 クエリ $0.001 未満**（AI Gateway では当面無料）

## 5. 熱量とピーク（`scoring.ts`）

- `smooth`：隣接 0.25/0.5/0.25 で広げるが、**ピークは下げない**（max）。孤立ヒットが半減して閾値を割るのを防ぐ
- `pickPeaks`：極大値かつ `p ≥ 0.5`、30 秒以上離す、最大 5 件、p 降順
- 閾値は `SeekConfig`（コード）に置く。質問文に書かない

## 6. 確信度の扱い

- boolean には confidence が無い。P(true) 自体を熱量に使う。0.4〜0.6 は「たぶん」として薄く描く（消さない）
- `any` が低く（< 0.3）ヒットが無いとき → 「この動画では話していないようです」。`any` が高いのにヒットが無いとき → 「はっきりした箇所は見つかりませんでした」（閾値を下げる余地がある合図）

## 7. 失敗の落とし先

| 状況 | 挙動 |
| --- | --- |
| キー未設定 | Mock（キーワード一致）。UI に `mock` 表示。Jev の挙動は再現しない |
| Jev が 503 / 429 | 300 → 700 → 1500ms の間隔で 3 回だけ再試行（`withRetry`）。それでも駄目なら 502 で「Jev is busy right now. Try again in a moment」。混雑時に 503 を即返すことがある（2026-09-21 観測。大きい・多いリクエストほど当たりやすい） |
| その他の Gateway エラー / タイムアウト（8s） | 502 でエラー文言。リトライしない |
| トークン超過 | まず起きない（分割済み）。起きたら `SEEK_MAX_SEGMENTS_PER_REQUEST` を下げる |

## 8. 質問文を直すとき

1. `npm run eval` で hit@1 が落ちるクエリを見る
2. 記録（`SEEK_RECORD=1`）の P(true) 分布を見て、**当たりと外れの差（gap）** が狭ければ質問文を直す。gap が広いのに外れているなら閾値
3. 文脈を足すと P は全体に「穏やか」になる（誤検出は減るが見逃しが増える）。`video.title` を外す実験も一度やる
