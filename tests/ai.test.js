import test from "node:test";
import assert from "node:assert/strict";
import { quantities } from "../shared/ai/nlu.js";
import { parseTender, matchCost, computeTotals } from "../shared/ai/estimator.js";
import { compareQuotes } from "../shared/ai/procurement.js";
import { freshDb, as } from "./helpers.js";
import { call } from "../shared/service.js";

test("quantities with Arabic and English units", () => {
  const q = quantities("نحتاج 120 م2 بلاط و 35 م3 خرسانة و 50 كيس اسمنت and 3 rolls, 12 pcs fcu");
  assert.deepEqual(q.map(x => [x.qty, x.unit]), [[120, "m2"], [35, "m3"], [50, "bag"], [3, "roll"], [12, "no"]]);
});

test("field agent: progress + manpower, request → MR + RFQ, RFI, delay, safety, no project", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@watad.example");
  const bilal = dbx.get("SELECT id FROM users WHERE email='bilal@watad.example'").id;
  const p = await call(dbx, owner, "field.send", { sender_id: bilal, text: "اليوم في برج الياسمين ركبنا 150 م2 دكت و 10 فان كويل في الدور 8. العمالة 12 دكت و 5 مساعدين" });
  assert.equal(p.parsed.kind, "progress"); assert.equal(p.parsed.project_code, "P-2401");
  assert.deepEqual(p.parsed.progress.map(x => [x.code, x.qty]), [["DCT", 150], ["FCU", 10]]);
  assert.equal(p.parsed.manpower.reduce((a, m) => a + m.count, 0), 17);
  const r = await call(dbx, owner, "field.send", { sender_id: bilal, text: "نحتاج 400 متر كيبل 4x16 و 30 كشاف LED لمبنى المكاتب B قبل يوم الخميس" });
  assert.equal(r.parsed.project_code, "P-2403", "project named in the message wins over the sender's project");
  assert.equal(r.parsed.items.length, 2); assert.ok(r.created.mr);
  assert.ok(dbx.get("SELECT COUNT(*) n FROM quotes WHERE mr_id=?", [r.created.mr.id]).n >= 1);
  const q = await call(dbx, owner, "field.send", { sender_id: bilal, text: "في تعارض بين ماسورة الحريق والكمرة في الدور 4 بمدرسة الملقا، نرفع الماسورة ولا نلف حولها؟" });
  assert.equal(q.parsed.kind, "rfi"); assert.ok(q.created.rfi); assert.equal(q.parsed.progress.length, 0, "no fake progress from 'الدور 4'");
  const d = await call(dbx, owner, "field.send", { sender_id: bilal, text: "توقف تركيب اللوحات في مبنى المكاتب لأن الاستشاري ما اعتمد المخططات، متأخرين 3 أيام" });
  assert.equal(d.parsed.kind, "delay"); assert.equal(d.parsed.incident.cause, "consultant approval"); assert.equal(d.parsed.incident.delay_days, 3);
  const s = await call(dbx, owner, "field.send", { sender_id: bilal, text: "Near miss at Noor clinic: a ladder slipped, no injury." });
  assert.equal(s.parsed.kind, "safety"); assert.equal(s.parsed.incident.severity, "low");
  const f = await call(dbx, owner, "field.send", { sender_id: bilal, text: "Installed 85 m fire fighting pipe at Noor clinic today" });
  assert.equal(f.parsed.kind, "progress", "'fire fighting pipe' is a trade, not a fire");
  const n = await call(dbx, owner, "field.send", { sender: { name: "Foreman", phone: "+9665XX1" }, text: "خلصنا 40 رشاش اليوم" });
  assert.equal(dbx.get("SELECT status FROM field_messages WHERE id=?", [n.id]).status, "needs_review");
  await call(dbx, owner, "field.assign", { id: n.id, project_id: 2 });
  assert.equal(dbx.get("SELECT status FROM field_messages WHERE id=?", [n.id]).status, "applied");
});

test("AI PM answers with numbers that match the metrics", async () => {
  const dbx = await freshDb(); const owner = await as(dbx, "owner@watad.example");
  const late = await call(dbx, owner, "ask", { question: "إيه المشاريع المتأخرة؟" });
  assert.equal(late.intent, "delayed"); assert.equal(late.table.rows[0][0].slice(0, 6), "P-2401");
  const list = await call(dbx, owner, "projects.list"); const y = list.find(p => p.code === "P-2401");
  assert.equal(late.table.rows[0][3], y.stats.spi);
  assert.equal((await call(dbx, owner, "ask", { question: "which projects are over budget?" })).intent, "over_budget");
  assert.equal((await call(dbx, owner, "ask", { question: "المستخلصات المتأخرة" })).intent, "cash");
  assert.equal((await call(dbx, owner, "ask", { question: "open RFIs older than a week" })).intent, "rfis");
  const sum = await call(dbx, owner, "ask", { question: "وضع مشروع P-2403" }); assert.equal(sum.intent, "summary"); assert.deepEqual(sum.projects, ["P-2403"]);
});

test("procurement: like-for-like comparison, approval above the limit, PO and delivery cost", async () => {
  const dbx = await freshDb(); const proc = await as(dbx, "procurement@watad.example"); const owner = await as(dbx, "owner@watad.example");
  const q = [{ id: 1, supplier_id: 1, subtotal: 100, lines: [{ item_id: 1, qty: 1, rate: 100, amount: 100 }, { item_id: 2, qty: 1, rate: null, amount: 0 }], missing_items: 1, lead_days: 3 },
    { id: 2, supplier_id: 2, subtotal: 400, lines: [{ item_id: 1, qty: 1, rate: 120, amount: 120 }, { item_id: 2, qty: 1, rate: 280, amount: 280 }], missing_items: 0, lead_days: 3 }];
  const r = compareQuotes(q, { 1: { rating: 4, on_time_rate: 0.9 }, 2: { rating: 4, on_time_rate: 0.9 } }, { needed_by: "2099-01-01" });
  assert.equal(r[0].id, 2, "a partial cheap quote must not beat a complete one");
  const mr = dbx.get("SELECT * FROM material_requests WHERE status='quoted' ORDER BY id LIMIT 1");
  const best = dbx.get("SELECT * FROM quotes WHERE mr_id=? AND recommended=1", [mr.id]);
  const other = dbx.get("SELECT * FROM quotes WHERE mr_id=? AND recommended=0", [mr.id]);
  if (other) await assert.rejects(call(dbx, proc, "procurement.award", { id: mr.id, quote_id: other.id }), /reason/);
  const a = await call(dbx, proc, "procurement.award", { id: mr.id, quote_id: best.id });
  if (best.total > 50000) { assert.equal(a.status, "pending_approval"); const ap = dbx.get("SELECT * FROM approvals WHERE ref_id=? AND status='pending'", [mr.id]); const d = await call(dbx, owner, "approvals.decide", { id: ap.id, status: "approved" }); assert.ok(d.po); }
  else assert.equal(a.status, "po_issued");
  const po = dbx.get("SELECT * FROM purchase_orders WHERE mr_id=?", [mr.id]);
  const before = dbx.get("SELECT COUNT(*) n FROM costs").n;
  await call(dbx, proc, "procurement.deliver", { po_id: po.id });
  assert.equal(dbx.get("SELECT COUNT(*) n FROM costs").n, before + 1);
});

test("estimation: tender lines parsed, matched, unmatched flagged, totals add up", async () => {
  const dbx = await freshDb(); const costDb = dbx.all("SELECT * FROM cost_db WHERE tenant_id=1");
  const lines = parseTender("1.1 GI ductwork incl. supports - 2,300 m2\n1.2 Nurse call system complete - 1 ls\nA4\tChilled water pipe 2\" insulated\tm\t620");
  assert.deepEqual(lines.map(l => [l.qty, l.unit]), [[2300, "m2"], [1, "ls"], [620, "m"]]);
  assert.equal(matchCost(lines[0].description, "m2", costDb).match.code, "HV-01");
  assert.equal(matchCost(lines[1].description, "ls", costDb).match, null);
  const L = [{ qty: 10, material: 50, labor: 30, equipment: 20, unit_cost: 100 }];
  const T = computeTotals(L, { overhead_pct: 10, risk_pct: 5, margin_pct: 20 });
  assert.equal(T.direct, 1000); assert.equal(T.cost, 1150); assert.equal(T.price, 1437.5); assert.equal(T.effective_margin, 20);
  const owner = await as(dbx, "owner@watad.example");
  const e = await call(dbx, owner, "estimates.draft", { text: "GI ductwork incl. supports - 100 m2\nSmart lighting control - 1 ls" });
  assert.equal(e.lines.filter(l => l.flag).length, 1);
});

test("tenancy and roles", async () => {
  const dbx = await freshDb(); const lamsa = await as(dbx, "owner@lamsa.example"); const eng = await as(dbx, "bilal@watad.example");
  await assert.rejects(call(dbx, lamsa, "projects.get", { id: 1 }), /project_not_found/);
  assert.ok((await call(dbx, lamsa, "projects.list")).every(p => p.tenant_id === 2));
  await assert.rejects(call(dbx, eng, "procurement.award", { id: 1, quote_id: 1 }), /forbidden|Requires/);
  await assert.rejects(call(dbx, eng, "field.send", { sender_id: dbx.get("SELECT id FROM users WHERE email='karim@watad.example'").id, text: "x" }), /themselves/);
});
