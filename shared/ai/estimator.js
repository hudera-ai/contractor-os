// Estimation agent: tender / BOQ text → lines → matched to the company's cost database (material + labour
// + equipment unit rates) → direct cost → overhead, risk and margin → selling rates and a quotation.
// Unmatched or low-confidence lines are flagged for the estimator instead of being guessed.
import { normalize, quantities, unitOf } from "./nlu.js";

export function parseTender(text) {
  const lines = [];
  for (const raw0 of String(text || "").split(/\n+/)) {
    const raw = raw0.trim(); if (!raw || raw.length < 4) continue;
    if (/^(item|no\.?|description|البند|الوصف|bill of quantities|جدول الكميات)\b/iu.test(raw) && !/\d/.test(raw.replace(/^\S+/, ""))) continue;
    const ref = (/^\s*([A-Z]?\d+(?:[.\-]\d+)*)[.)\-\s]+/u.exec(raw) || [])[1] || null;
    let body = ref ? raw.replace(/^\s*[A-Z]?\d+(?:[.\-]\d+)*[.)\-\s]+/u, "") : raw;
    // table-ish: "description | unit | qty" or "description  m2  120"
    let qty = null, unit = null;
    const cells = body.split(/\s*[|\t]\s*|\s{2,}/).filter(Boolean);
    if (cells.length >= 3) {
      const u = cells.map(c => unitOf(c)); const n = cells.map(c => (/^\d[\d,]*(?:\.\d+)?$/.test(c.trim()) ? +c.replace(/,/g, "") : null));
      const ui = u.findIndex(Boolean), ni = n.findIndex((x, i) => x != null && i > 0);
      if (ui > 0 && ni > 0) { unit = u[ui]; qty = n[ni]; body = cells.slice(0, Math.min(ui, ni)).join(" "); }
    }
    if (qty == null) { const q = quantities(body).at(-1); if (q) { qty = q.qty; unit = q.unit; body = (body.slice(0, body.length) ).replace(new RegExp(q.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$", "iu"), "").replace(/[-–—:]\s*$/, "").trim(); } }
    if (qty == null) { const m = /[-–—:]\s*(\d[\d,]*(?:\.\d+)?)\s*(\S+)\s*$/u.exec(body); if (m && unitOf(m[2])) { qty = +m[1].replace(/,/g, ""); unit = unitOf(m[2]); body = body.slice(0, m.index).trim(); } }
    lines.push({ ref, description: body.replace(/\s+/g, " ").trim(), qty, unit, raw });
  }
  return lines;
}

export function matchCost(desc, unit, costDb) {
  const t = normalize(desc); const ranked = [];
  for (const c of costDb) {
    const kws = c.keywords.split(",").map(s => normalize(s.trim())).filter(Boolean);
    const hits = kws.filter(k => t.includes(k)); if (!hits.length) continue;
    let score = hits.reduce((a, k) => a + Math.min(12, k.length), 0);
    const sizes = t.match(/\d+(?:\.\d+)?\s*(?:mm|ملم|مم|"|inch|انش|tr|طن تبريد|sqmm|mm2)/giu) || [];
    if (sizes.some(s => kws.some(k => k.includes(normalize(s).replace(/\s/g, ""))))) score += 10;
    if (unit && c.unit === unit) score += 8; else if (unit && c.unit !== unit) score -= 6;
    ranked.push({ c, score, hits });
  }
  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0]; if (!best) return { match: null, confidence: 0, alternatives: [] };
  const confidence = Math.min(0.97, +(best.score / (best.score + (ranked[1]?.score || 4) + 6) + 0.25).toFixed(2));
  return { match: best.c, confidence, hits: best.hits, alternatives: ranked.slice(1, 3).map(r => ({ id: r.c.id, code: r.c.code, description: r.c.description })) };
}

export function buildEstimate(text, costDb, { overhead_pct = 10, margin_pct = 12, risk_pct = null, lang = "en" } = {}) {
  const L = (ar, en) => (lang === "ar" ? ar : en);
  const parsed = parseTender(text); const trace = []; const lines = [];
  trace.push({ k: "parse", label: L("قراءة المناقصة", "Read the tender"), detail: `${parsed.length} ${L("سطر", "lines")} · ${parsed.filter(l => l.qty != null).length} ${L("بكميات", "with quantities")}` });
  for (const p of parsed) {
    const m = matchCost(p.description, p.unit, costDb);
    const ok = m.match && m.confidence >= 0.55 && p.qty != null;
    const c = m.match;
    const rate = c ? { material: c.material, labor: c.labor, equipment: c.equipment } : { material: 0, labor: 0, equipment: 0 };
    const unitCost = rate.material + rate.labor + rate.equipment;
    lines.push({ ref: p.ref, description: p.description, qty: p.qty, unit: p.unit || c?.unit || null, cost_id: c?.id ?? null, cost_code: c?.code ?? null, cost_desc: c ? (lang === "ar" ? c.description_ar : c.description) : null,
      ...rate, unit_cost: +unitCost.toFixed(2), direct: p.qty != null ? +(unitCost * p.qty).toFixed(2) : 0, confidence: m.confidence, flag: ok ? null : !c ? "no_match" : p.qty == null ? "no_qty" : "low_confidence",
      alternatives: m.alternatives, labor_days: c?.productivity && p.qty ? +(p.qty / +c.productivity).toFixed(1) : null });
  }
  const flagged = lines.filter(l => l.flag).length;
  const autoRisk = risk_pct ?? Math.min(8, 2 + flagged * 1.5);
  trace.push({ k: "match", label: L("مطابقة بقاعدة الأسعار", "Matched to cost database"), detail: `${lines.length - flagged}/${lines.length} ${L("بند مطابق", "matched")}${flagged ? ` · ${flagged} ${L("بحاجة لمراجعة", "need review")}` : ""}` });
  const totals = computeTotals(lines, { overhead_pct, risk_pct: autoRisk, margin_pct });
  trace.push({ k: "price", label: L("التسعير", "Pricing"), detail: `${L("تكلفة مباشرة", "direct")} ${fmt(totals.direct)} · ${L("مصاريف عامة", "overhead")} ${overhead_pct}% · ${L("مخاطر", "risk")} ${autoRisk}%${risk_pct == null ? L(" (تلقائي حسب البنود غير المؤكدة)", " (auto from uncertain lines)") : ""} · ${L("ربح", "margin")} ${margin_pct}%` });
  trace.push({ k: "result", label: L("سعر البيع", "Selling price"), detail: `${fmt(totals.price)} ${L("قبل الضريبة", "excl. VAT")} · ${L("هامش فعلي", "effective margin")} ${totals.effective_margin}%` });
  return { lines, totals, overhead_pct, risk_pct: autoRisk, margin_pct, trace };
}

export function computeTotals(lines, { overhead_pct, risk_pct, margin_pct }) {
  const sum = k => +lines.reduce((a, l) => a + (l.qty || 0) * (l[k] || 0), 0).toFixed(2);
  const material = sum("material"), labor = sum("labor"), equipment = sum("equipment");
  const direct = +(material + labor + equipment).toFixed(2);
  const overhead = +(direct * overhead_pct / 100).toFixed(2), risk = +(direct * risk_pct / 100).toFixed(2);
  const cost = direct + overhead + risk;
  const price = +(cost / (1 - margin_pct / 100)).toFixed(2);
  const factor = direct ? price / direct : 1;
  for (const l of lines) l.sell_rate = +(l.unit_cost * factor).toFixed(2), l.sell_amount = +((l.qty || 0) * l.sell_rate).toFixed(2);
  const labor_days = +lines.reduce((a, l) => a + (l.labor_days || 0), 0).toFixed(1);
  return { material, labor, equipment, direct, overhead, risk, cost: +cost.toFixed(2), price, vat: +(price * 0.15).toFixed(2), total: +(price * 1.15).toFixed(2), effective_margin: price ? +(100 * (price - cost) / price).toFixed(1) : 0, labor_days };
}
const fmt = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
