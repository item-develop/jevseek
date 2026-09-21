// 記録（JSONL）。SEEK_RECORD=1 のときだけ書く。Node でのみ動く（拡張機能からは呼ばれない）
import { appendFile, mkdir } from "node:fs/promises";

let enabled = process.env.SEEK_RECORD === "1";
const file = () => `recordings/${new Date().toISOString().slice(0, 10)}.jsonl`;

export function setRecording(on: boolean) { enabled = on; }

export async function record(entry: Record<string, unknown>): Promise<void> {
  if (!enabled) return;
  await mkdir("recordings", { recursive: true });
  await appendFile(file(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}
