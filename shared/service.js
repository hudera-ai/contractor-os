// Contractor OS service: every operation (dbx, ctx, args) in OPS — run by the Node server over RPC and by
// the browser demo directly. Tenant scoping and role checks live here.
import { verifyPassword, randomToken } from "./auth.js";
import { parseFieldMessage, replyFor } from "./ai/field.js";
import { answer as pmAnswer } from "./ai/pm.js";
import { pickSuppliers, simulateQuote, compareQuotes, PO_APPROVAL_LIMIT } from "./ai/procurement.js";
import { buildEstimate, computeTotals } from "./ai/estimator.js";
import { projectStats, health, isoDay } from "./metrics.js";

export class ApiError extends Error { constructor(status, code, message) { super(message || code); this.status = status; this.code = code; } }
const J = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const now = () => new Date();
const stamp = (d = now()) => `${isoDay(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
const tid = ctx => { if (!ctx?.user) throw new ApiError(401, "unauthenticated"); return ctx.user.tenant_id; };
function need(ctx, roles) { if (!ctx?.user) throw new ApiError(401, "unauthenticated"); if (ctx.user.role === "owner") return; if (!roles.includes(ctx.user.role)) throw new ApiError(403, "forbidden", `Requires: owner, ${roles.join(", ")}`); }
function audit(dbx, ctx, action, entity, id, detail, actor) { dbx.run("INSERT INTO audit_log (tenant_id,at,user_id,actor,action,entity,entity_id,detail) VALUES (?,?,?,?,?,?,?,?)", [ctx?.user?.tenant_id ?? null, stamp(), ctx?.user?.id ?? null, actor || ctx?.user?.name || null, action, entity, id ?? null, detail ? JSON.stringify(detail).slice(0, 500) : null]); }
const project = (dbx, ctx, id) => { const p = dbx.get("SELECT * FROM projects WHERE id=? AND tenant_id=?", [+id, tid(ctx)]); if (!p) throw new ApiError(404, "project_not_found"); return p; };
const nextNo = (dbx, table, col, prefix, where = "", args = []) => { const n = dbx.get(`SELECT COUNT(*) n FROM ${table} ${where}`, args).n + 1; return `${prefix}${String(n).padStart(3, "0")}`; };

// ------------------------------------------------------------------ field message processing (shared with seed)
export function processFieldMessage(dbx, { tenant_id, sender, text, at = now(), project_id = null, existing_id = null }) {
  const projects = dbx.all("SELECT * FROM projects WHERE tenant_id=? AND status<>'closed'", [tenant_id]);
  const pids = projects.map(p => p.id);
  const activities = pids.length ? dbx.all(`SELECT * FROM activities WHERE project_id IN (${pids.map(() => "?").join(",")})`, pids) : [];
  const catalog = dbx.all("SELECT * FROM catalog WHERE tenant_id=?", [tenant_id]);
  const s = project_id ? { ...sender, project_id: +project_id } : sender;
  const r = parseFieldMessage(text, { projects: project_id ? projects.filter(p => p.id === +project_id) : projects, activities, catalog, sender: s, now: at });
  if (project_id && !r.project_id) r.project_id = +project_id;
  const created = {}; const d = isoDay(at); const atS = stamp(at);
  let id = existing_id;
  if (!id) id = dbx.run("INSERT INTO field_messages (tenant_id,project_id,sender_user_id,sender_name,sender_phone,body,at) VALUES (?,?,?,?,?,?,?)", [tenant_id, r.project_id, sender.id ?? null, sender.name, sender.phone ?? null, text, atS]).lastId;
  if (!r.needs_review) {
    for (const p of r.progress) dbx.run("INSERT INTO progress_entries (activity_id,date,qty,note,message_id) VALUES (?,?,?,?,?)", [p.activity_id, d, p.qty, "field message", id]);
    for (const m of r.manpower) dbx.run("INSERT INTO manpower (project_id,date,trade,count,message_id) VALUES (?,?,?,?,?)", [r.project_id, d, m.trade, m.count, id]);
    if (r.items.length) {
      const no = nextNo(dbx, "material_requests", "no", "MR-", "WHERE tenant_id=?", [tenant_id]);
      const mr = dbx.run("INSERT INTO material_requests (tenant_id,project_id,no,requested_by,needed_by,status,created_at,message_id) VALUES (?,?,?,?,?,?,?,?)", [tenant_id, r.project_id, no, sender.name, r.needed_by, "new", atS, id]).lastId;
      for (const it of r.items) dbx.run("INSERT INTO mr_items (mr_id,catalog_id,description,qty,unit) VALUES (?,?,?,?,?)", [mr, it.catalog_id, it.description, it.qty ?? 1, it.unit]);
      const rq = sendRfq(dbx, tenant_id, mr, at, r.lang);
      created.mr = { id: mr, no }; r.trace.push({ k: "tool", label: "procurement.rfq", detail: `${no} → ${rq.suppliers.join(", ")} · ${rq.quotes} ${r.lang === "ar" ? "عروض" : "quotes"}` });
    }
    if (r.rfi) {
      const n = dbx.get("SELECT COUNT(*) n FROM rfis WHERE project_id=?", [r.project_id]).n + 1; const code = projects.find(p => p.id === r.project_id)?.code;
      const no = `RFI-${code}-${String(n).padStart(3, "0")}`;
      const rid = dbx.run("INSERT INTO rfis (project_id,no,subject,question,location,discipline,status,raised_at,due_at,message_id) VALUES (?,?,?,?,?,?,?,?,?,?)", [r.project_id, no, r.rfi.subject, r.rfi.question, r.rfi.location, r.rfi.discipline, "open", atS, isoDay(new Date(at.getTime() + 7 * 864e5)), id]).lastId;
      created.rfi = { id: rid, no }; r.trace.push({ k: "tool", label: "rfis.create", detail: `${no} · ${r.lang === "ar" ? "رد الاستشاري خلال 7 أيام" : "consultant reply due in 7 days"}` });
    }
    if (r.incident) {
      const iid = dbx.run("INSERT INTO incidents (project_id,kind,description,severity,cause,delay_days,at,status,message_id) VALUES (?,?,?,?,?,?,?,?,?)", [r.project_id, r.incident.kind, r.incident.description, r.incident.severity, r.incident.cause || null, r.incident.delay_days || null, atS, "open", id]).lastId;
      created.incident = { id: iid, kind: r.incident.kind };
    }
    if (r.progress.length) r.trace.push({ k: "tool", label: "progress.record", detail: r.progress.map(p => `${p.code} +${p.qty}`).join(" · ") });
  }
  const reply = replyFor(r, { mrNo: created.mr?.no, rfiNo: created.rfi?.no });
  r.trace.push({ k: "reply", label: r.lang === "ar" ? "الرد على المرسل" : "Reply to sender", detail: "whatsapp" });
  dbx.run("UPDATE field_messages SET project_id=?, kind=?, confidence=?, parsed=?, trace=?, status=?, routed_to=?, reply=? WHERE id=?",
    [r.project_id, r.kind, r.confidence, JSON.stringify({ progress: r.progress, manpower: r.manpower, items: r.items, rfi: r.rfi, incident: r.incident, needed_by: r.needed_by, unmatched: r.unmatched, created }), JSON.stringify(r.trace), r.needs_review ? "needs_review" : "applied", r.route.map(x => x[0]).filter((v, i, a) => a.indexOf(v) === i).join(","), reply, id]);
  return { id, parsed: r, reply, created };
}

export function sendRfq(dbx, tenant_id, mrId, at = now(), lang = "en") {
  const mr = dbx.get("SELECT * FROM material_requests WHERE id=?", [mrId]);
  const items = dbx.all("SELECT * FROM mr_items WHERE mr_id=?", [mrId]);
  const catalog = Object.fromEntries(dbx.all("SELECT * FROM catalog WHERE tenant_id=?", [tenant_id]).map(c => [c.id, c]));
  const cats = [...new Set(items.map(i => catalog[i.catalog_id]?.category).filter(Boolean))];
  const sups = pickSuppliers(dbx.all("SELECT * FROM suppliers WHERE tenant_id=?", [tenant_id]), cats);
  dbx.run("DELETE FROM quotes WHERE mr_id=?", [mrId]);
  for (const s of sups) { const q = simulateQuote(mr, items, s, catalog, at); dbx.run("INSERT INTO quotes (mr_id,supplier_id,lines,subtotal,vat,total,lead_days,valid_until,missing_items,received_at) VALUES (?,?,?,?,?,?,?,?,?,?)", [mrId, s.id, JSON.stringify(q.lines), q.subtotal, q.vat, q.total, q.lead_days, q.valid_until, q.missing_items, stamp(new Date(at.getTime() + 3600e3))]); }
  rankQuotes(dbx, mrId, at, lang);
  dbx.run("UPDATE material_requests SET status=? WHERE id=?", [sups.length ? "quoted" : "rfq_sent", mrId]);
  return { suppliers: sups.map(s => s.name), quotes: sups.length };
}
function rankQuotes(dbx, mrId, at = now(), lang = "en") {
  const mr = dbx.get("SELECT * FROM material_requests WHERE id=?", [mrId]);
  const quotes = dbx.all("SELECT * FROM quotes WHERE mr_id=?", [mrId]).map(q => ({ ...q, lines: J(q.lines, []) }));
  const sups = Object.fromEntries(dbx.all("SELECT * FROM suppliers WHERE tenant_id=?", [mr.tenant_id]).map(s => [s.id, s]));
  const ranked = compareQuotes(quotes, sups, { needed_by: mr.needed_by, now: at, lang });
  for (const q of ranked) dbx.run("UPDATE quotes SET score=?, recommended=?, reasons=? WHERE id=?", [q.score, q.recommended ? 1 : 0, JSON.stringify({ reasons: q.reasons, parts: q.parts }), q.id]);
  return ranked;
}
export function issuePo(dbx, tenant_id, mrId, quoteId, at = now()) {
  const q = dbx.get("SELECT * FROM quotes WHERE id=? AND mr_id=?", [quoteId, mrId]);
  const no = nextNo(dbx, "purchase_orders", "no", "PO-", "WHERE tenant_id=?", [tenant_id]);
  const id = dbx.run("INSERT INTO purchase_orders (tenant_id,mr_id,quote_id,supplier_id,no,total,issued_at,expected_at,status) VALUES (?,?,?,?,?,?,?,?,?)", [tenant_id, mrId, q.id, q.supplier_id, no, q.total, stamp(at), isoDay(new Date(at.getTime() + q.lead_days * 864e5)), "issued"]).lastId;
  dbx.run("UPDATE material_requests SET status='po_issued' WHERE id=?", [mrId]);
  return { id, no };
}

// ------------------------------------------------------------------ operations
export const OPS = {
  async "auth.login"(dbx, ctx, { email, password }) {
    const u = dbx.get("SELECT * FROM users WHERE lower(email)=lower(?) AND active=1", [String(email || "").trim()]);
    if (!u || !(await verifyPassword(String(password || ""), u.password_hash))) throw new ApiError(401, "bad_credentials", "Wrong email or password");
    const { password_hash, ...user } = u; return { token: randomToken(), user };
  },
  "session.info"(dbx, ctx) {
    const t = tid(ctx); const u = ctx.user;
    const tenant = dbx.get("SELECT * FROM tenants WHERE id=?", [t]);
    const approvals = dbx.get("SELECT COUNT(*) n FROM approvals WHERE tenant_id=? AND status='pending' AND (approver_role=? OR ?='owner')", [t, u.role, u.role]).n;
    const review = dbx.get("SELECT COUNT(*) n FROM field_messages WHERE tenant_id=? AND status='needs_review'", [t]).n;
    const projects = dbx.all("SELECT id, code, name_ar, name_en, engineer_user_id FROM projects WHERE tenant_id=? AND status<>'closed' ORDER BY code", [t]);
    return { user: u, tenant, counts: { approvals, field: review }, projects };
  },
  "users.list"(dbx, ctx) { return dbx.all("SELECT u.id,u.name,u.email,u.phone,u.role,(SELECT code FROM projects p WHERE p.engineer_user_id=u.id LIMIT 1) AS project FROM users u WHERE tenant_id=? ORDER BY role, name", [tid(ctx)]); },

  // ---------- portfolio
  "dashboard.summary"(dbx, ctx) {
    const t = tid(ctx); const n = now();
    const projects = dbx.all("SELECT p.*, u.name pm_name FROM projects p LEFT JOIN users u ON u.id=p.pm_user_id WHERE p.tenant_id=? AND p.status<>'closed' ORDER BY p.code", [t]).map(p => { const s = projectStats(dbx, p, n); delete s.activities; return { ...p, stats: s, health: health(s) }; });
    const sum = k => projects.reduce((a, p) => a + p.stats[k], 0);
    const contract = projects.reduce((a, p) => a + p.contract_value, 0);
    const pr = pmAnswer(dbx, { tenant_id: t, question: "priorities this week", now: n });
    const weeks = []; for (let w = 11; w >= 0; w--) weeks.push(isoDay(new Date(n.getTime() - w * 7 * 864e5)));
    const ids = projects.map(p => p.id);
    const earnedByWeek = weeks.map(w => ({ x: w, y: Math.round(dbx.get(`SELECT COALESCE(SUM(e.qty * a.budget_cost / a.qty),0) s FROM progress_entries e JOIN activities a ON a.id=e.activity_id WHERE a.project_id IN (${ids.map(() => "?").join(",") || "0"}) AND e.date<=?`, [...ids, w]).s / 1000) }));
    const costByWeek = weeks.map(w => ({ x: w, y: Math.round(dbx.get(`SELECT COALESCE(SUM(amount),0) s FROM costs WHERE project_id IN (${ids.map(() => "?").join(",") || "0"}) AND date<=?`, [...ids, w]).s / 1000) }));
    return { projects, contract, bac: sum("bac"), ev: sum("ev"), ac: sum("ac"), pv: sum("pv"), billed: sum("billed"), collected: sum("collected"), overdue_receivables: sum("overdue_receivables"), open_rfis: sum("open_rfis"), manpower: sum("manpower_today"),
      spi: +(sum("ev") / Math.max(1, sum("pv"))).toFixed(2), cpi: +(sum("ev") / Math.max(1, sum("ac"))).toFixed(2), priorities: pr.table?.rows.slice(0, 6) || [], earnedByWeek, costByWeek,
      recent: dbx.all("SELECT f.*, p.code FROM field_messages f LEFT JOIN projects p ON p.id=f.project_id WHERE f.tenant_id=? ORDER BY f.at DESC, f.id DESC LIMIT 8", [t]),
      approvals: dbx.get("SELECT COUNT(*) n FROM approvals WHERE tenant_id=? AND status='pending'", [t]).n };
  },
  "projects.list"(dbx, ctx) { const n = now(); return dbx.all("SELECT p.*, u.name pm_name, e.name engineer_name FROM projects p LEFT JOIN users u ON u.id=p.pm_user_id LEFT JOIN users e ON e.id=p.engineer_user_id WHERE p.tenant_id=? ORDER BY p.code", [tid(ctx)]).map(p => { const s = projectStats(dbx, p, n); delete s.activities; return { ...p, stats: s, health: health(s) }; }); },
  "projects.get"(dbx, ctx, { id }) {
    const p = project(dbx, ctx, id); const n = now(); const s = projectStats(dbx, p, n);
    const months = dbx.all("SELECT substr(date,1,7) m, category, SUM(amount) s FROM costs WHERE project_id=? GROUP BY m, category ORDER BY m", [p.id]);
    const weeks = []; const start = new Date(p.start_date); for (let d = new Date(start); d <= n && weeks.length < 80; d = new Date(d.getTime() + 7 * 864e5)) weeks.push(isoDay(d)); weeks.push(isoDay(n));
    const acts = dbx.all("SELECT * FROM activities WHERE project_id=?", [p.id]);
    const planned = weeks.map(w => ({ x: w, y: +(100 * acts.reduce((a, x) => a + x.budget_cost * Math.min(1, Math.max(0, (new Date(w) - new Date(x.planned_start)) / Math.max(1, new Date(x.planned_end) - new Date(x.planned_start)))), 0) / s.bac).toFixed(1) }));
    const earned = weeks.map(w => ({ x: w, y: +(100 * dbx.get("SELECT COALESCE(SUM(MIN(e.qty, a.qty) * a.budget_cost / a.qty),0) s FROM progress_entries e JOIN activities a ON a.id=e.activity_id WHERE a.project_id=? AND e.date<=?", [p.id, w]).s / s.bac).toFixed(1) }));
    const actual = weeks.map(w => ({ x: w, y: +(100 * dbx.get("SELECT COALESCE(SUM(amount),0) s FROM costs WHERE project_id=? AND date<=?", [p.id, w]).s / s.bac).toFixed(1) }));
    return { ...p, stats: s, health: health(s), months, curve: { planned, earned, actual },
      pm: dbx.get("SELECT id,name FROM users WHERE id=?", [p.pm_user_id]), engineer: dbx.get("SELECT id,name,phone FROM users WHERE id=?", [p.engineer_user_id]),
      rfis: dbx.all("SELECT * FROM rfis WHERE project_id=? ORDER BY raised_at DESC", [p.id]), incidents: dbx.all("SELECT * FROM incidents WHERE project_id=? ORDER BY at DESC", [p.id]),
      mrs: dbx.all("SELECT m.*, (SELECT no FROM purchase_orders po WHERE po.mr_id=m.id LIMIT 1) po_no FROM material_requests m WHERE project_id=? ORDER BY created_at DESC", [p.id]),
      invoices: dbx.all("SELECT * FROM invoices WHERE project_id=? ORDER BY date DESC", [p.id]),
      messages: dbx.all("SELECT * FROM field_messages WHERE project_id=? ORDER BY at DESC LIMIT 12", [p.id]).map(m => ({ ...m, parsed: J(m.parsed, {}), trace: J(m.trace, []) })),
      manpower: dbx.all("SELECT date, SUM(count) n FROM manpower WHERE project_id=? GROUP BY date ORDER BY date DESC LIMIT 21", [p.id]).reverse() };
  },
  "rfis.answer"(dbx, ctx, { id, answer }) { need(ctx, ["pm"]); const r = dbx.get("SELECT r.* FROM rfis r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND p.tenant_id=?", [+id, tid(ctx)]); if (!r) throw new ApiError(404, "not_found"); dbx.run("UPDATE rfis SET status='answered', answer=?, answered_at=? WHERE id=?", [answer || "", stamp(), r.id]); audit(dbx, ctx, "answer", "rfi", r.id); return { ok: true }; },
  "incidents.close"(dbx, ctx, { id }) { need(ctx, ["pm"]); const r = dbx.get("SELECT i.* FROM incidents i JOIN projects p ON p.id=i.project_id WHERE i.id=? AND p.tenant_id=?", [+id, tid(ctx)]); if (!r) throw new ApiError(404, "not_found"); dbx.run("UPDATE incidents SET status='closed' WHERE id=?", [r.id]); audit(dbx, ctx, "close", "incident", r.id); return { ok: true }; },

  // ---------- field inbox
  "field.senders"(dbx, ctx) {
    const t = tid(ctx);
    return dbx.all("SELECT u.id, u.name, u.phone, u.role, p.id project_id, p.code FROM users u LEFT JOIN projects p ON p.engineer_user_id=u.id WHERE u.tenant_id=? AND u.role IN ('site_engineer','pm') ORDER BY u.role DESC, u.name", [t])
      .concat([{ id: null, name: "Foreman Rashid (subcontractor)", phone: "+9665XX660001", role: "foreman", project_id: null, code: null }]);
  },
  "field.list"(dbx, ctx, { status, project_id, limit = 60 } = {}) {
    const w = ["f.tenant_id=?"], a = [tid(ctx)]; if (status) { w.push("f.status=?"); a.push(status); } if (project_id) { w.push("f.project_id=?"); a.push(+project_id); }
    return dbx.all(`SELECT f.*, p.code FROM field_messages f LEFT JOIN projects p ON p.id=f.project_id WHERE ${w.join(" AND ")} ORDER BY f.at DESC, f.id DESC LIMIT ?`, [...a, +limit]).map(m => ({ ...m, parsed: J(m.parsed, {}), trace: J(m.trace, []) }));
  },
  "field.send"(dbx, ctx, { sender_id, sender, text, project_id }) {
    const t = tid(ctx); if (!String(text || "").trim()) throw new ApiError(400, "validation", "Type a message");
    let s = sender_id ? dbx.get("SELECT u.id, u.name, u.phone, p.id project_id FROM users u LEFT JOIN projects p ON p.engineer_user_id=u.id WHERE u.id=? AND u.tenant_id=?", [+sender_id, t]) : null;
    if (!s) s = { id: null, name: sender?.name || ctx.user.name, phone: sender?.phone || null, project_id: null };
    if (ctx.user.role === "site_engineer" && s.id !== ctx.user.id) throw new ApiError(403, "forbidden", "Site engineers send as themselves");
    const r = processFieldMessage(dbx, { tenant_id: t, sender: s, text: String(text).slice(0, 3000), project_id });
    audit(dbx, ctx, "field_message", "field_message", r.id, { kind: r.parsed.kind }, "AI field agent");
    return { id: r.id, reply: r.reply, created: r.created, parsed: { ...r.parsed, trace: undefined }, trace: r.parsed.trace };
  },
  "field.assign"(dbx, ctx, { id, project_id }) {
    need(ctx, ["pm"]); const t = tid(ctx); const m = dbx.get("SELECT * FROM field_messages WHERE id=? AND tenant_id=?", [+id, t]); if (!m) throw new ApiError(404, "not_found");
    if (m.status === "applied") throw new ApiError(409, "already_applied");
    project(dbx, ctx, project_id);
    const r = processFieldMessage(dbx, { tenant_id: t, sender: { id: m.sender_user_id, name: m.sender_name, phone: m.sender_phone }, text: m.body, at: new Date(m.at.replace(" ", "T")), project_id, existing_id: m.id });
    audit(dbx, ctx, "assign", "field_message", m.id, { project_id }); return { reply: r.reply, created: r.created };
  },
  "field.ignore"(dbx, ctx, { id }) { need(ctx, ["pm"]); dbx.run("UPDATE field_messages SET status='ignored' WHERE id=? AND tenant_id=?", [+id, tid(ctx)]); return { ok: true }; },

  // ---------- AI project manager
  "ask"(dbx, ctx, { question }) {
    const t = tid(ctx); if (!String(question || "").trim()) throw new ApiError(400, "validation");
    const r = pmAnswer(dbx, { tenant_id: t, question: String(question).slice(0, 500), now: now() });
    dbx.run("INSERT INTO ai_questions (tenant_id,user_id,question,intent,answer,at) VALUES (?,?,?,?,?,?)", [t, ctx.user.id, question, r.intent, r.text, stamp()]);
    return r;
  },
  "ask.history"(dbx, ctx) { return dbx.all("SELECT q.*, u.name FROM ai_questions q LEFT JOIN users u ON u.id=q.user_id WHERE q.tenant_id=? ORDER BY q.id DESC LIMIT 12", [tid(ctx)]); },

  // ---------- procurement
  "procurement.list"(dbx, ctx, { status } = {}) {
    const t = tid(ctx);
    return dbx.all(`SELECT m.*, p.code, p.name_en project_en, p.name_ar project_ar, (SELECT COUNT(*) FROM mr_items i WHERE i.mr_id=m.id) items, (SELECT COUNT(*) FROM quotes q WHERE q.mr_id=m.id) quotes,
      (SELECT MIN(total) FROM quotes q WHERE q.mr_id=m.id AND q.recommended=1) best_total, (SELECT no FROM purchase_orders po WHERE po.mr_id=m.id) po_no
      FROM material_requests m JOIN projects p ON p.id=m.project_id WHERE m.tenant_id=? ${status ? "AND m.status=?" : ""} ORDER BY m.created_at DESC`, status ? [t, status] : [t]);
  },
  "procurement.get"(dbx, ctx, { id }) {
    const t = tid(ctx); const m = dbx.get("SELECT m.*, p.code, p.name_en project_en, p.name_ar project_ar FROM material_requests m JOIN projects p ON p.id=m.project_id WHERE m.id=? AND m.tenant_id=?", [+id, t]);
    if (!m) throw new ApiError(404, "not_found");
    const quotes = dbx.all("SELECT q.*, s.name supplier, s.rating, s.on_time_rate, s.city, s.payment_terms FROM quotes q JOIN suppliers s ON s.id=q.supplier_id WHERE q.mr_id=? ORDER BY q.score DESC", [m.id]).map(q => ({ ...q, lines: J(q.lines, []), reasons: J(q.reasons, {}) }));
    return { ...m, items: dbx.all("SELECT i.*, c.code cat_code, c.category FROM mr_items i LEFT JOIN catalog c ON c.id=i.catalog_id WHERE mr_id=?", [m.id]), quotes,
      po: dbx.get("SELECT po.*, s.name supplier FROM purchase_orders po JOIN suppliers s ON s.id=po.supplier_id WHERE po.mr_id=?", [m.id]),
      approval: dbx.get("SELECT * FROM approvals WHERE kind='po' AND ref_id=? ORDER BY id DESC", [m.id]), message: m.message_id ? dbx.get("SELECT body, sender_name, at FROM field_messages WHERE id=?", [m.message_id]) : null, limit: PO_APPROVAL_LIMIT };
  },
  "procurement.create"(dbx, ctx, { project_id, needed_by, items }) {
    need(ctx, ["procurement", "pm", "site_engineer"]); const t = tid(ctx); const p = project(dbx, ctx, project_id);
    if (!Array.isArray(items) || !items.length) throw new ApiError(400, "validation", "Add at least one item");
    const no = nextNo(dbx, "material_requests", "no", "MR-", "WHERE tenant_id=?", [t]);
    const id = dbx.run("INSERT INTO material_requests (tenant_id,project_id,no,requested_by,needed_by,status,created_at) VALUES (?,?,?,?,?,?,?)", [t, p.id, no, ctx.user.name, needed_by || isoDay(new Date(Date.now() + 5 * 864e5)), "new", stamp()]).lastId;
    for (const it of items) { const c = dbx.get("SELECT * FROM catalog WHERE id=? AND tenant_id=?", [+it.catalog_id, t]); if (!c) continue; dbx.run("INSERT INTO mr_items (mr_id,catalog_id,description,qty,unit) VALUES (?,?,?,?,?)", [id, c.id, c.name_en, +it.qty || 1, c.unit]); }
    audit(dbx, ctx, "create", "material_request", id); return { id, no };
  },
  "procurement.rfq"(dbx, ctx, { id, lang = "en" }) { need(ctx, ["procurement"]); const t = tid(ctx); const m = dbx.get("SELECT * FROM material_requests WHERE id=? AND tenant_id=?", [+id, t]); if (!m) throw new ApiError(404, "not_found"); if (["po_issued", "delivered"].includes(m.status)) throw new ApiError(409, "closed"); const r = sendRfq(dbx, t, m.id, now(), lang); audit(dbx, ctx, "rfq", "material_request", m.id, r); return r; },
  "procurement.award"(dbx, ctx, { id, quote_id, reason }) {
    need(ctx, ["procurement"]); const t = tid(ctx);
    const m = dbx.get("SELECT m.*, p.code FROM material_requests m JOIN projects p ON p.id=m.project_id WHERE m.id=? AND m.tenant_id=?", [+id, t]); if (!m) throw new ApiError(404, "not_found");
    if (!["quoted", "approved"].includes(m.status)) throw new ApiError(409, "invalid_state", `Request is ${m.status}`);
    const q = dbx.get("SELECT q.*, s.name supplier FROM quotes q JOIN suppliers s ON s.id=q.supplier_id WHERE q.id=? AND q.mr_id=?", [+quote_id, m.id]); if (!q) throw new ApiError(404, "quote_not_found");
    if (!q.recommended && !String(reason || "").trim()) throw new ApiError(400, "reason_required", "Choosing a quote that isn't the recommended one needs a reason");
    if (q.total > PO_APPROVAL_LIMIT && ctx.user.role !== "owner") {
      dbx.run("INSERT INTO approvals (tenant_id,kind,ref_id,title,amount,reason,approver_role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)", [t, "po", m.id, JSON.stringify({ quote_id: q.id, en: `PO for ${m.no} (${m.code}) — ${q.supplier}`, ar: `أمر شراء ${m.no} (${m.code}) — ${q.supplier}` }), q.total, reason || null, "owner", "pending", stamp()]);
      dbx.run("UPDATE material_requests SET status='pending_approval' WHERE id=?", [m.id]); audit(dbx, ctx, "request_approval", "material_request", m.id, { total: q.total });
      return { status: "pending_approval", limit: PO_APPROVAL_LIMIT };
    }
    const po = issuePo(dbx, t, m.id, q.id); audit(dbx, ctx, "issue_po", "purchase_order", po.id, { total: q.total, reason }); return { status: "po_issued", po };
  },
  "procurement.deliver"(dbx, ctx, { po_id }) {
    need(ctx, ["procurement", "pm", "site_engineer"]); const t = tid(ctx);
    const po = dbx.get("SELECT po.*, m.project_id FROM purchase_orders po JOIN material_requests m ON m.id=po.mr_id WHERE po.id=? AND po.tenant_id=?", [+po_id, t]); if (!po) throw new ApiError(404, "not_found");
    if (po.status !== "issued") throw new ApiError(409, "invalid_state");
    dbx.run("UPDATE purchase_orders SET status='delivered', delivered_at=? WHERE id=?", [stamp(), po.id]); dbx.run("UPDATE material_requests SET status='delivered' WHERE id=?", [po.mr_id]);
    dbx.run("INSERT INTO costs (project_id,date,category,amount,ref,note) VALUES (?,?,?,?,?,?)", [po.project_id, isoDay(now()), "material", +(po.total / 1.15).toFixed(2), po.no, "delivered"]);
    audit(dbx, ctx, "deliver", "purchase_order", po.id); return { ok: true };
  },
  "suppliers.list"(dbx, ctx) { const t = tid(ctx); return dbx.all("SELECT s.*, (SELECT COUNT(*) FROM purchase_orders po WHERE po.supplier_id=s.id) pos, (SELECT COALESCE(SUM(total),0) FROM purchase_orders po WHERE po.supplier_id=s.id) spend FROM suppliers s WHERE tenant_id=? ORDER BY spend DESC", [t]); },
  "catalog.list"(dbx, ctx) { return dbx.all("SELECT * FROM catalog WHERE tenant_id=? ORDER BY category, code", [tid(ctx)]); },

  // ---------- estimation
  "estimates.list"(dbx, ctx) { return dbx.all("SELECT e.id,e.no,e.client,e.title,e.status,e.created_at,e.totals,e.margin_pct,u.name author FROM estimates e LEFT JOIN users u ON u.id=e.created_by WHERE e.tenant_id=? ORDER BY e.id DESC", [tid(ctx)]).map(e => ({ ...e, totals: J(e.totals, {}) })); },
  "estimates.get"(dbx, ctx, { id }) { const e = dbx.get("SELECT * FROM estimates WHERE id=? AND tenant_id=?", [+id, tid(ctx)]); if (!e) throw new ApiError(404, "not_found"); return { ...e, lines: J(e.lines, []), totals: J(e.totals, {}), tenant: dbx.get("SELECT * FROM tenants WHERE id=?", [e.tenant_id]) }; },
  "estimates.draft"(dbx, ctx, { text, overhead_pct = 10, margin_pct = 12, risk_pct = null, lang = "en" }) {
    const t = tid(ctx); if (!String(text || "").trim()) throw new ApiError(400, "validation", "Paste the tender / BOQ text");
    return buildEstimate(text, dbx.all("SELECT * FROM cost_db WHERE tenant_id=?", [t]), { overhead_pct: +overhead_pct, margin_pct: +margin_pct, risk_pct: risk_pct === "" || risk_pct == null ? null : +risk_pct, lang });
  },
  "estimates.recalc"(dbx, ctx, { lines, overhead_pct, risk_pct, margin_pct }) { tid(ctx); return { lines, totals: computeTotals(lines, { overhead_pct: +overhead_pct, risk_pct: +risk_pct, margin_pct: +margin_pct }) }; },
  "estimates.save"(dbx, ctx, { id, client, title, text, lines, overhead_pct, risk_pct, margin_pct, status = "draft" }) {
    need(ctx, ["estimator"]); const t = tid(ctx);
    if (!client?.trim() || !title?.trim() || !Array.isArray(lines) || !lines.length) throw new ApiError(400, "validation", "Client, title and at least one line are required");
    const totals = computeTotals(lines, { overhead_pct: +overhead_pct, risk_pct: +risk_pct, margin_pct: +margin_pct });
    if (id) { dbx.run("UPDATE estimates SET client=?, title=?, tender_text=?, lines=?, overhead_pct=?, risk_pct=?, margin_pct=?, totals=?, status=? WHERE id=? AND tenant_id=?", [client, title, text || "", JSON.stringify(lines), overhead_pct, risk_pct, margin_pct, JSON.stringify(totals), status, +id, t]); audit(dbx, ctx, "update", "estimate", +id); return { id: +id }; }
    const no = `EST-${new Date().getFullYear()}-${String(dbx.get("SELECT COUNT(*) n FROM estimates WHERE tenant_id=?", [t]).n + 1).padStart(3, "0")}`;
    const nid = dbx.run("INSERT INTO estimates (tenant_id,no,client,title,tender_text,lines,overhead_pct,risk_pct,margin_pct,totals,status,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [t, no, client, title, text || "", JSON.stringify(lines), overhead_pct, risk_pct, margin_pct, JSON.stringify(totals), status, stamp(), ctx.user.id]).lastId;
    audit(dbx, ctx, "create", "estimate", nid); return { id: nid, no };
  },
  "estimates.status"(dbx, ctx, { id, status }) { need(ctx, ["estimator"]); if (!["draft", "submitted", "won", "lost"].includes(status)) throw new ApiError(400, "validation"); dbx.run("UPDATE estimates SET status=? WHERE id=? AND tenant_id=?", [status, +id, tid(ctx)]); audit(dbx, ctx, status, "estimate", +id); return { ok: true }; },
  "costdb.list"(dbx, ctx) { return dbx.all("SELECT * FROM cost_db WHERE tenant_id=? ORDER BY trade, code", [tid(ctx)]); },

  // ---------- approvals & audit
  "approvals.list"(dbx, ctx, { status = "pending" } = {}) {
    const t = tid(ctx);
    return dbx.all(`SELECT a.*, u.name decided_by_name FROM approvals a LEFT JOIN users u ON u.id=a.decided_by WHERE a.tenant_id=? ${status === "all" ? "" : "AND a.status=?"} ORDER BY a.id DESC`, status === "all" ? [t] : [t, status])
      .map(a => ({ ...a, title: J(a.title, { en: a.title }), can_decide: a.status === "pending" && (ctx.user.role === "owner" || ctx.user.role === a.approver_role), detail: a.kind === "po" ? OPS["procurement.get"](dbx, ctx, { id: a.ref_id }) : null }));
  },
  "approvals.decide"(dbx, ctx, { id, status, comment }) {
    const t = tid(ctx); const a = dbx.get("SELECT * FROM approvals WHERE id=? AND tenant_id=?", [+id, t]); if (!a) throw new ApiError(404, "not_found");
    if (a.status !== "pending") throw new ApiError(409, "already_decided");
    if (ctx.user.role !== "owner" && ctx.user.role !== a.approver_role) throw new ApiError(403, "forbidden");
    if (!["approved", "rejected"].includes(status)) throw new ApiError(400, "validation");
    dbx.run("UPDATE approvals SET status=?, decided_by=?, decided_at=?, comment=? WHERE id=?", [status, ctx.user.id, stamp(), comment || null, a.id]);
    let po = null;
    if (a.kind === "po") { const p = J(a.title, {}); if (status === "approved") po = issuePo(dbx, t, a.ref_id, p.quote_id); else dbx.run("UPDATE material_requests SET status='quoted' WHERE id=?", [a.ref_id]); }
    audit(dbx, ctx, status, "approval", a.id, { kind: a.kind, comment }); return { ok: true, po };
  },
  "audit.list"(dbx, ctx) { return dbx.all("SELECT * FROM audit_log WHERE tenant_id=? ORDER BY id DESC LIMIT 60", [tid(ctx)]); },
};

export async function call(dbx, ctx, op, args = {}) {
  const fn = OPS[op]; if (!fn) throw new ApiError(404, "unknown_op", `Unknown operation ${op}`);
  if (op !== "auth.login" && !ctx?.user) throw new ApiError(401, "unauthenticated");
  return await fn(dbx, ctx, args || {});
}
