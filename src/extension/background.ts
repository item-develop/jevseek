// 拡張機能の service worker。content script と localhost サーバーの間の中継、およびキーボードコマンド。
// youtube.com のオリジンから localhost へ直接 fetch すると CORS / ローカルネットワークアクセスの許可に引っかかるため、
// host_permissions を持つここが代わりに叩く。キーは持たない（サーバーだけが持つ。CLAUDE.md 5）。
const SERVER = "http://localhost:8787";

interface ServerCall { path: string; body?: unknown }
interface ServerReply { ok: boolean; status: number; data: unknown }

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "jevseek:server") return;
  const ac = new AbortController();
  const post = (m: ServerReply) => { try { port.postMessage(m); } catch { /* 相手が先に切った */ } };
  port.onDisconnect.addListener(() => ac.abort()); // content 側の中断（次の打鍵）をそのままサーバー側の中断にする
  port.onMessage.addListener(async (msg: ServerCall) => {
    try {
      const res = await fetch(SERVER + msg.path, {
        method: msg.body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: msg.body === undefined ? undefined : JSON.stringify(msg.body),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      post({ ok: res.ok, status: res.status, data });
    } catch (e) {
      if (ac.signal.aborted) return;
      const msgText = /Failed to fetch|NetworkError|ECONNREFUSED/.test(String(e)) ? "Can't reach the server (npm run dev)" : String((e as Error).message ?? e);
      post({ ok: false, status: 0, data: { error: msgText } });
    }
  });
});

// ⌘⇧F / Ctrl+Shift+F（chrome://extensions/shortcuts で変更可）。ページ側の keydown でも拾うが、こちらはフォーカス位置に依らない
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== "toggle-panel") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: "jevseek:toggle" }).catch(() => { /* watch ページ以外 */ });
});

// ツールバーのアイコンをクリック → そのタブのパネルを開閉（watch ページ以外では何も起きない）
chrome.action?.onClicked.addListener((tab) => {
  if (tab.id != null) chrome.tabs.sendMessage(tab.id, { type: "jevseek:toggle" }).catch(() => { /* content script が無いページ */ });
});
