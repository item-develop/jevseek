// ローカルサーバー。拡張機能と CLI が叩く。AI Gateway のキーはここだけが持つ。
//  POST /api/seek        SeekRequest → SeekResponse
//  GET  /api/transcript  ?v=<videoId>  サーバー側で字幕を取る（CLI 用フォールバック。拡張機能はページ内で取る）
//  GET  /api/health
import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { describeJevError, seek } from "../jev/evaluate";
import { configFromEnv, evaluatorFromEnv } from "../jev/config";
import { chunkCues, type SeekRequest } from "../core";
import { fetchTranscriptServerSide } from "./transcript";

const app = new Hono();
const cfg = configFromEnv();
const ev = evaluatorFromEnv();

app.use("/api/*", cors({ origin: (o) => o }));

app.get("/api/health", (c) => c.json({ backend: ev.name, model: process.env.JEV_MODEL ?? "typesafe-ai/jev", cfg }));

app.post("/api/seek", async (c) => {
  const body = (await c.req.json()) as SeekRequest;
  if (!body.query?.trim() || !Array.isArray(body.segments) || body.segments.length === 0) {
    return c.json({ error: "query and segments are required" }, 400);
  }
  try {
    const res = await seek(body, ev, cfg, AbortSignal.timeout(8000));
    return c.json(res);
  } catch (e) {
    return c.json({ error: describeJevError(e), backend: ev.name }, 502);
  }
});

app.get("/api/transcript", async (c) => {
  const v = c.req.query("v");
  if (!v) return c.json({ error: "v=<videoId>" }, 400);
  try {
    const tr = await fetchTranscriptServerSide(v);
    const segments = chunkCues(tr.cues, { windowSec: cfg.windowSec, windowChars: cfg.windowChars });
    return c.json({ meta: tr.meta, cues: tr.cues, segments });
  } catch (e) {
    return c.json({ error: String((e as Error).message ?? e) }, 502);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`[jevseek] backend=${ev.name} questionType=${cfg.questionType} http://localhost:${port}`);
