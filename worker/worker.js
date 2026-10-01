// MasGains Worker: whole-app sync blob (/data) plus the feedback queue (/feedback).
//
// Sync: GET returns the stored blob, POST replaces it. Any path that is not
// /feedback behaves this way, which is what the app has always relied on.
//
// Feedback, read by the hourly agent in ~/.claude/scheduled-tasks/masgains-feedback-agent:
//   GET  /feedback              list, newest first (no image bytes)
//   POST /feedback              {text, images:[dataURL]} -> {ok, item}
//   GET  /feedback/img/<imgId>  the image as a data URL string
//   POST /feedback/<id>         {status?, reply?, shipped?} -> {ok, item}
// SYNC_TOKEN (the app) may do everything. AGENT_KEY may use /feedback only.

const STATUSES = ["new", "working", "done", "declined", "withdrawn"];
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 3_000_000; // ~2.2MB jpeg; the app sends ~300KB
const MAX_TEXT = 4000;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const isApp = !!env.SYNC_TOKEN && token === env.SYNC_TOKEN;
    const isAgent = !!env.AGENT_KEY && token === env.AGENT_KEY;
    const path = new URL(request.url).pathname.replace(/\/+$/, "");

    if (path === "/feedback" || path.startsWith("/feedback/")) {
      if (!isApp && !isAgent) return json({ error: "unauthorized" }, 401);
      return feedback(request, env, path, isApp, json);
    }

    if (!isApp) return json({ error: "unauthorized" }, 401);
    const KEY = "appdata";
    if (request.method === "GET") {
      const data = await env.DATA.get(KEY);
      return new Response(data || "null", { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (request.method === "POST") {
      await env.DATA.put(KEY, await request.text());
      return json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};

async function loadIndex(env) {
  try { return JSON.parse((await env.DATA.get("fb:index")) || "[]"); } catch (e) { return []; }
}
const saveIndex = (env, list) => env.DATA.put("fb:index", JSON.stringify(list));
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

async function feedback(request, env, path, isApp, json) {
  const rest = path.slice("/feedback".length).replace(/^\//, "");

  if (request.method === "GET" && rest === "") {
    const list = await loadIndex(env);
    return json({ ok: true, items: list.slice().sort((a, b) => b.created - a.created) });
  }

  if (request.method === "GET" && rest.startsWith("img/")) {
    const img = await env.DATA.get("fb:img:" + rest.slice(4));
    if (!img) return json({ error: "not found" }, 404);
    return new Response(img, { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" } });
  }

  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }

  if (rest === "") {
    if (!isApp) return json({ error: "only the app can submit" }, 403);
    const text = String(body.text || "").trim().slice(0, MAX_TEXT);
    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    if (!text && !images.length) return json({ error: "empty" }, 400);
    const imgIds = [];
    for (const d of images) {
      if (typeof d !== "string" || !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(d) || d.length > MAX_IMAGE_CHARS) {
        return json({ error: "bad image" }, 400);
      }
      const imgId = rid();
      await env.DATA.put("fb:img:" + imgId, d);
      imgIds.push(imgId);
    }
    const now = Date.now();
    const item = { id: "FB-" + rid(), text, images: imgIds, status: "new", reply: "", shipped: "", created: now, updated: now };
    const list = await loadIndex(env);
    list.push(item);
    await saveIndex(env, list);
    return json({ ok: true, item });
  }

  const list = await loadIndex(env);
  const item = list.find((x) => x.id === rest);
  if (!item) return json({ error: "not found" }, 404);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return json({ error: "bad status" }, 400);
    // The app can only withdraw its own unstarted request; the agent drives the rest.
    if (isApp && !(body.status === "withdrawn" && item.status === "new")) return json({ error: "not allowed" }, 403);
    item.status = body.status;
  }
  if (!isApp) {
    if (body.reply !== undefined) item.reply = String(body.reply).slice(0, 2000);
    if (body.shipped !== undefined) item.shipped = String(body.shipped).slice(0, 80);
  }
  item.updated = Date.now();
  await saveIndex(env, list);
  return json({ ok: true, item });
}
