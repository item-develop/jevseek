# 05. 検証の回し方

「動いた」ではなく「述語クエリで当たる」を確認する。Mock は配線確認用で、精度は Jev でしか測れない。

## 0. 前提

```
cp .env.example .env      # AI_GATEWAY_API_KEY を入れる（無ければ Mock で動く）
npm i
npm run typecheck && npm run test
```

## 1. 配線（Mock、キー不要）

```
npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "他社機 比較" --mock
npm run eval -- --mock
```
Mock はキーワード一致なので、述語型（「脱線」「困ってる」）は外れる。**外れるのが正常**。

## 2. Jev で 1 クエリ

```
npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "話が脱線してるところ"
npm run seek -- --fixture fixtures/transcripts/sample_ja.json --q "ゲストが困ってるところ" --score
```
見るもの：hits の位置、`any`、heat の形、レイテンシ、トークン数。

## 3. 評価セット

```
npm run eval
```
`fixtures/eval/*.json` の各クエリで、上位ヒットが期待区間（±20 秒）に入るかを **hit@1 / hit@3** で出す。

合格ライン（v1）
- 合成データ `sample_ja`：hit@1 が 6/6（述語型 2 問を含む）
- 実動画を 3 本追加して、hit@1 ≥ 80%

評価セットの作り方：動画を見て「ここ」と思う区間を人が書く。区間は広めでよい（±20 秒の許容がある）。

## 4. boolean と score の比較

`.env` の `SEEK_QUESTION_TYPE` を切り替えて `npm run eval` を 2 回。hit@1 と、当たり／外れの P の差（記録を見る）で決める。

## 5. 記録と再現

```
SEEK_RECORD=1 npm run seek -- …
```
`recordings/YYYY-MM-DD.jsonl` に state・questions・answers・usage が残る。質問文を変える前後で同じクエリを記録し、P(true) の分布を比べる。

## 6. 実動画で試す（サーバー側取得）

```
npm run seek -- --url "https://www.youtube.com/watch?v=XXXXXXXXXXX" --q "値段を言ったところ"
```
字幕が取れない（`字幕が空でした`）ときは YouTube 側でブロックされている。yt-dlp で json3 を落として `Transcript` 形式（`{ meta, cues:[{start,dur,text}] }`）に直し、`--fixture` で回す。拡張機能はページ内で取るので影響を受けにくい。

## 7. 拡張機能の手動チェック

```
npm run dev            # サーバー
npm run build:ext      # dist/extension
```
chrome://extensions → デベロッパーモード → 「パッケージ化されていない拡張機能を読み込む」→ `dist/extension`

- [ ] watch ページで ⌘⇧F → パネルが出て入力にフォーカス
- [ ] 打鍵中に候補と山が更新される。打ち直すと前の結果が消える
- [ ] Enter / クリックで該当秒へ飛ぶ（1.5 秒手前）
- [ ] 入力中に k / f / 数字キーが YouTube に取られない
- [ ] 別の動画に遷移するとパネル・山が消え、新しい字幕で動く
- [ ] 字幕なし動画で「字幕がない動画です」
- [ ] サーバー停止で「サーバーに接続できません（npm run dev）」
- [ ] 全画面でも同じ位置に出る
- [ ] `prefers-reduced-motion` で遷移が消える
- [ ] DevTools のコンソールに `[jevseek] transcript: N cues → M segments (経路, 言語)` が出る。経路が `direct` 以外（`transcript` / `player` / `captured`）でも正常。全部失敗すると「字幕を読めませんでした」
- [ ] 拡張機能を再読み込みした後の古いタブで「拡張機能が更新されました。ページを再読み込みしてください」が出る（クラッシュしない）

自動操作の Chrome（chrome-devtools-mcp 等）では YouTube が timedtext と get_transcript を空 / 400 で返すため、字幕経路は **手元の普段の Chrome** で確認する。
UI・キー操作・シークバー描画は自動操作でも確認できる（2026-09-21 に確認済み）。

## 8. デモ動画を撮る前に

- 1 本の動画で 3 クエリ（固有名詞型 1、述語型 2）が hit@1 で当たること
- レイテンシが表示上 0.3〜0.8s に収まること（超えるなら `SEEK_MAX_SEGMENTS_PER_REQUEST` を下げて並列度を上げる）
- パネルに `mock` が出ていないこと
