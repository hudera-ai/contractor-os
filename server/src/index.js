// HUDERA Contractor OS server: RPC for the app + a WhatsApp Cloud API webhook for site messages.
// Same service code as the in-browser demo.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { call, ApiError, processFieldMessage, OPS } from "../../shared/service.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "..");
const PORT = +process.env.PORT || 3000;
const dbx = await openDb();
const app = express();
app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");

const sessions = new Map();
const ctxOf = req => sessions.get((req.headers.authorization || "").replace(/^Bearer\s+/i, "")) || {};
const fail = (res, e) => { const st = e instanceof ApiError ? e.status : 500; if (st === 500) console.error(e); res.status(st).json({ error: e.code || "server_error", message: e.message }); };

app.get("/api/health", (req, res) => res.json({ ok: true, service: "hudera-contractor-os" }));
app.post("/api/rpc/auth.login", async (req, res) => { try { const r = await call(dbx, {}, "auth.login", req.body); sessions.set(r.token, { user: r.user }); res.json(r); } catch (e) { fail(res, e); } });
app.post("/api/rpc/auth.logout", (req, res) => { sessions.delete((req.headers.authorization || "").replace(/^Bearer\s+/i, "")); res.json({ ok: true }); });
app.post("/api/rpc/:op", async (req, res) => { try { res.json((await call(dbx, ctxOf(req), req.params.op, req.body)) ?? { ok: true }); } catch (e) { fail(res, e); } });

// WhatsApp Cloud API: site engineers text the company number; the sender is matched by phone to a user.
// Set WHATSAPP_VERIFY_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_ID (and TENANT_ID if you run one tenant per number).
app.get("/webhooks/whatsapp", (req, res) => (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN ? res.send(req.query["hub.challenge"]) : res.sendStatus(403)));
app.post("/webhooks/whatsapp", async (req, res) => {
  res.sendStatus(200);
  try {
    for (const entry of req.body?.entry || []) for (const ch of entry.changes || []) for (const m of ch.value?.messages || []) {
      if (m.type !== "text") continue;
      const phone = "+" + m.from;
      const u = dbx.get("SELECT u.id, u.name, u.phone, u.tenant_id, p.id project_id FROM users u LEFT JOIN projects p ON p.engineer_user_id=u.id WHERE u.phone=?", [phone]);
      const tenant_id = u?.tenant_id || +process.env.TENANT_ID || null; if (!tenant_id) continue;
      const r = processFieldMessage(dbx, { tenant_id, sender: u || { id: null, name: ch.value.contacts?.[0]?.profile?.name || phone, phone }, text: m.text.body });
      await whatsappSend(m.from, r.reply);
    }
  } catch (e) { console.error("[whatsapp]", e); }
});
async function whatsappSend(to, body) {
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) { console.log(`[whatsapp:dry-run] → ${to}: ${body.slice(0, 120)}`); return; }
  await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_ID}/messages`, { method: "POST", headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }) });
}

app.use(express.static(ROOT, { index: "index.html", extensions: ["html"] }));
app.get("/{*path}", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.listen(PORT, () => console.log(`HUDERA Contractor OS on http://localhost:${PORT} (ops: ${Object.keys(OPS).length})`));
