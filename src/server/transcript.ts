// サーバー側の字幕取得（CLI / eval 用）。watch ページの HTML から captionTracks を抜いて json3 を取る。
// YouTube 側の変更で壊れやすい。壊れたら `yt-dlp --skip-download --write-auto-sub --sub-format json3` で
// 取った JSON を fixtures に置き、--fixture で回す（docs/05）。拡張機能はこの経路を使わない。
import { extractCaptionTracksFromHtml, json3Url, parseJson3, pickTrack, type Transcript } from "../core";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

export async function fetchTranscriptServerSide(videoId: string, preferred = ["ja", "en"]): Promise<Transcript> {
  const html = await (await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=ja`, { headers: { "user-agent": UA, "accept-language": "ja,en;q=0.8" } })).text();
  const tracks = extractCaptionTracksFromHtml(html);
  const track = pickTrack(tracks, preferred);
  if (!track) throw new Error("字幕トラックが見つかりません（字幕なし動画か、YouTube 側のページ構造変更）");
  const json = await (await fetch(json3Url(track.baseUrl), { headers: { "user-agent": UA } })).json();
  const cues = parseJson3(json);
  if (cues.length === 0) throw new Error("字幕が空でした（timedtext がブロックされた可能性。拡張機能かフィクスチャを使ってください）");
  const title = /<title>(.*?)<\/title>/.exec(html)?.[1]?.replace(/ - YouTube$/, "");
  return { meta: { videoId, title, lang: track.languageCode, auto: track.kind === "asr" }, cues };
}
