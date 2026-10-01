#!/usr/bin/env node
// Feedback queue helper for the masgains-feedback-agent scheduled task.
//   node feedback.mjs list                       new + working items as JSON; screenshots saved to .feedback/<id>/
//   node feedback.mjs all                        every item as JSON
//   node feedback.mjs set <id> <status> [reply] [shipped]
// Statuses: working, done, declined. Key: .agent-key (gitignored). URL: MG_FEEDBACK_URL or the live Worker.
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const URL_BASE = (process.env.MG_FEEDBACK_URL || "https://masapp-sync.mmohammad.workers.dev").replace(/\/+$/, "");
const KEY = (process.env.MG_AGENT_KEY || readFileSync(join(ROOT, ".agent-key"), "utf8")).trim();
const H = { Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function req(path, opts = {}) {
  const r = await fetch(URL_BASE + path, { headers: H, ...opts });
  const t = await r.text();
  if (!r.ok) { console.error(`HTTP ${r.status} ${path}: ${t}`); process.exit(1); }
  return t;
}

const [cmd, id, status, reply, shipped] = process.argv.slice(2);
if (cmd === "list" || cmd === "all") {
  let items = JSON.parse(await req("/feedback")).items;
  if (cmd === "list") items = items.filter((x) => x.status === "new" || x.status === "working").reverse(); // oldest first
  for (const it of items) {
    it.imageFiles = [];
    for (const [i, imgId] of (it.images || []).entries()) {
      const dir = join(ROOT, ".feedback", it.id);
      const data = await req("/feedback/img/" + encodeURIComponent(imgId));
      const mm = /^data:image\/(\w+);base64,(.*)$/s.exec(data);
      if (!mm) continue;
      const file = join(dir, `${i + 1}.${mm[1] === "jpeg" ? "jpg" : mm[1]}`);
      if (!existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, Buffer.from(mm[2], "base64")); }
      it.imageFiles.push(file);
    }
  }
  console.log(JSON.stringify(items, null, 2));
} else if (cmd === "set" && id && status) {
  const body = { status };
  if (reply !== undefined) body.reply = reply;
  if (shipped !== undefined) body.shipped = shipped;
  console.log(await req("/feedback/" + encodeURIComponent(id), { method: "POST", body: JSON.stringify(body) }));
} else {
  console.error("usage: node feedback.mjs list | all | set <id> <working|done|declined> [reply] [shipped]");
  process.exit(2);
}
