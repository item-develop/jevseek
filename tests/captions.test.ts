import { describe, it, expect } from "vitest";
import { parseJson3, parseSrv3, parseTimedtext, parseTranscriptResponse, pickTrack, extractCaptionTracksFromHtml } from "../src/core";

describe("timedtext parsing", () => {
  it("parses json3 and skips empty events", () => {
    const cues = parseJson3({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "はい、" }, { utf8: "始まります" }] }, { tStartMs: 500 }, { tStartMs: 1000, dDurationMs: 800, segs: [{ utf8: "\n" }] }] });
    expect(cues).toEqual([{ start: 0, dur: 1, text: "はい、始まります" }]);
  });

  it("parses srv3 xml with entities and inner tags", () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="1200" d="2300" w="1"><s ac="255">値段は</s><s> 20&amp;万円</s></p><p t="4000" d="500" a="1"></p><p t="5000" d="1000">it&#39;s &lt;fine&gt;</p></body></timedtext>`;
    expect(parseSrv3(xml)).toEqual([
      { start: 1.2, dur: 2.3, text: "値段は 20&万円" },
      { start: 5, dur: 1, text: "it's <fine>" },
    ]);
  });

  it("parseTimedtext dispatches on the body and returns [] for empty bodies", () => {
    expect(parseTimedtext("")).toEqual([]);
    expect(parseTimedtext("   ")).toEqual([]);
    expect(parseTimedtext("not json")).toEqual([]);
    expect(parseTimedtext('{"events":[{"tStartMs":10,"dDurationMs":20,"segs":[{"utf8":"a"}]}]}')).toEqual([{ start: 0.01, dur: 0.02, text: "a" }]);
    expect(parseTimedtext('<transcript><p t="10" d="20">a</p></transcript>')).toHaveLength(1);
  });

  it("parses get_transcript responses (transcriptSegmentRenderer) and sorts by start", () => {
    const json = {
      actions: [{ updateEngagementPanelAction: { content: { transcriptRenderer: { content: { transcriptSearchPanelRenderer: { body: { transcriptSegmentListRenderer: { initialSegments: [
        { transcriptSegmentRenderer: { startMs: "3000", endMs: "5000", snippet: { runs: [{ text: "二つ目" }] } } },
        { transcriptSectionHeaderRenderer: { startMs: "0" } },
        { transcriptSegmentRenderer: { startMs: "0", endMs: "2500", snippet: { runs: [{ text: "一つ" }, { text: "目" }] } } },
      ] } } } } } } } }],
    };
    expect(parseTranscriptResponse(json)).toEqual([
      { start: 0, dur: 2.5, text: "一つ目" },
      { start: 3, dur: 2, text: "二つ目" },
    ]);
  });

  it("pickTrack prefers language order, then manual over asr", () => {
    const tracks = [
      { baseUrl: "u1", languageCode: "en", kind: "asr" },
      { baseUrl: "u2", languageCode: "ja", kind: "asr" },
      { baseUrl: "u3", languageCode: "ja" },
      { baseUrl: "u4", languageCode: "en" },
    ];
    expect(pickTrack(tracks, ["ja", "en"])?.baseUrl).toBe("u3");
    expect(pickTrack(tracks, ["en"])?.baseUrl).toBe("u4");
    expect(pickTrack(tracks, ["de"])?.baseUrl).toBe("u3"); // 無ければ手動字幕を先頭から
    expect(pickTrack([], ["ja"])).toBeUndefined();
  });

  it("extracts captionTracks from watch html", () => {
    const html = `<script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=x&lang=ja","languageCode":"ja","kind":"asr"}],"audioTracks":[]}}};</script>`;
    expect(extractCaptionTracksFromHtml(html)).toEqual([{ baseUrl: "https://www.youtube.com/api/timedtext?v=x&lang=ja", languageCode: "ja", kind: "asr" }]);
  });
});
