// Estimation agent: paste a tender / BOQ → priced build-up from the cost database → quotation.
import { h, ic, table, toast, modal, chip } from "../ui.js";
import { t, LANG, fdate, ago, nf } from "../i18n.js";
import { rpc, app, navigate, rerender } from "../main.js";
import { stChip, sar, trace } from "./common.js";

const SAMPLE = `BILL OF QUANTITIES — Al-Aqeeq Medical Center, Riyadh (HVAC, electrical, fire fighting)
1.1 GI ductwork incl. supports - 2,300 m2
1.2 Duct insulation 25mm - 2,300 m2
1.3 Fan coil units 2TR ducted - 64 no
1.4 Chilled water pipe 4" insulated - 380 m
1.5 Air handling unit 10,000 cfm - 4 no
2.1 Cable 4x95mm2 XLPE - 900 m
2.2 Cable tray 300mm perforated - 650 m
2.3 LED panel 60x60 - 780 no
2.4 Distribution board 24-way - 18 no
2.5 Nurse call system complete - 1 ls
3.1 Fire fighting pipe 2" sch40 - 1,600 m
3.2 Sprinkler heads pendent - 950 no
3.3 Smoke detectors addressable - 420 no
3.4 Fire hose cabinets - 14 no`;

export async function estimation(app_, route) {
  if (route.name === "estimate" && route.id === "new") return editor();
  if (route.name === "estimate" && route.id) return view(route.id);
  const list = await rpc("estimates.list");
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Estimation")), h("h1", {}, t("Tenders priced by the estimation agent"))), h("a", { class: "btn primary", href: "#/estimate/new" }, ic("plus"), t("New estimate"))),
    h("div", { class: "card" }, table([{ l: "#", v: e => h("code", {}, e.no) }, { l: t("Tender"), v: e => h("div", {}, h("b", { class: "small" }, e.title), h("div", { class: "xs muted" }, e.client)) }, { l: t("Price excl. VAT"), v: e => sar(e.totals.price), r: 1 }, { l: t("Margin"), v: e => `${e.totals.effective_margin}%`, r: 1 }, { l: t("By"), v: e => e.author || "—" }, { l: t("Created"), v: e => fdate(e.created_at) }, { l: t("Status"), v: e => stChip(e.status) }], list, { onRow: e => navigate(`#/estimate/${e.id}`) })));
}

function editor() {
  let est = null; const text = h("textarea", { rows: 12, placeholder: t("Paste the BOQ / tender lines here — one item per line with quantity and unit."), dir: "auto" });
  const oh = h("input", { type: "number", value: 10, style: { maxWidth: "90px" } }), mg = h("input", { type: "number", value: 12, style: { maxWidth: "90px" } }), rk = h("input", { type: "number", placeholder: t("auto"), style: { maxWidth: "90px" } });
  const client = h("input", { placeholder: t("Client") }), title = h("input", { placeholder: t("Tender title") });
  const out = h("div", {}); let costDb = [];
  const build = async () => {
    try { est = await rpc("estimates.draft", { text: text.value, overhead_pct: oh.value, margin_pct: mg.value, risk_pct: rk.value, lang: LANG }); if (!costDb.length) costDb = await rpc("costdb.list"); if (!title.value) title.value = (text.value.split("\n")[0] || "").replace(/^bill of quantities\s*[—-]\s*/i, "").slice(0, 80); draw(true); }
    catch (e) { toast(e.message, true); }
  };
  const recalc = async () => { const r = await rpc("estimates.recalc", { lines: est.lines, overhead_pct: oh.value, risk_pct: est.risk_pct, margin_pct: mg.value }); est.lines = r.lines; est.totals = r.totals; est.overhead_pct = +oh.value; est.margin_pct = +mg.value; draw(false); };
  const setCost = (l, id) => { const c = costDb.find(x => x.id === +id); if (!c) return; Object.assign(l, { cost_id: c.id, cost_code: c.code, cost_desc: LANG === "ar" ? c.description_ar : c.description, material: c.material, labor: c.labor, equipment: c.equipment, unit_cost: c.material + c.labor + c.equipment, flag: l.qty == null ? "no_qty" : null, confidence: 1, unit: l.unit || c.unit }); recalc(); };
  function draw(animate) {
    const T = est.totals;
    out.replaceChildren(
      h("div", { class: "grid", style: { gridTemplateColumns: "2.2fr 1fr", marginTop: "14px" }, "data-r": "stack" },
        h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Priced build-up")), h("span", { class: "sp" }), h("span", { class: "xs muted" }, `${est.lines.filter(l => l.flag).length} ${t("need review")}`)),
          table([{ l: "#", v: l => l.ref || "" }, { l: t("Tender item"), v: l => h("div", { dir: "auto", class: "est-desc" }, h("b", { class: "small" }, l.description), l.cost_desc ? h("div", { class: "xs muted" }, `→ ${l.cost_code} ${l.cost_desc}`) : null) },
            { l: t("Qty"), v: l => h("input", { type: "number", value: l.qty ?? "", style: { width: "90px" }, onchange: e => { l.qty = e.target.value === "" ? null : +e.target.value; l.flag = l.qty == null ? "no_qty" : l.cost_id ? null : l.flag; recalc(); } }), r: 1 }, { l: t("Unit"), v: l => l.unit || "—" },
            { l: t("Unit cost"), v: l => l.flag === "no_match" || l.flag === "low_confidence" ? h("select", { style: { width: "200px" }, onchange: e => setCost(l, e.target.value) }, h("option", { value: "" }, t("Pick a rate…")), ...costDb.map(c => h("option", { value: c.id, selected: c.id === l.cost_id }, `${c.code} · ${c.description} (${c.unit})`))) : nf(l.unit_cost, 2), r: 1 },
            { l: t("Sell rate"), v: l => nf(l.sell_rate, 2), r: 1 }, { l: t("Amount"), v: l => nf(l.sell_amount, 0), r: 1 },
            { l: "", v: l => l.flag ? chip(t({ no_match: "no rate", no_qty: "no qty", low_confidence: "check" }[l.flag]), "amber") : chip(`${Math.round(l.confidence * 100)}%`, "green", false) }], est.lines)),
        h("div", { class: "col" },
          h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Totals"))), h("div", { class: "bd" }, h("dl", { class: "kv" },
            h("dt", {}, t("Material")), h("dd", {}, sar(T.material)), h("dt", {}, t("Labour")), h("dd", {}, sar(T.labor)), h("dt", {}, t("Equipment")), h("dd", {}, sar(T.equipment)), h("dt", {}, h("b", {}, t("Direct cost"))), h("dd", {}, h("b", {}, sar(T.direct))),
            h("dt", {}, `${t("Overhead")} ${est.overhead_pct}%`), h("dd", {}, sar(T.overhead)), h("dt", {}, `${t("Risk")} ${est.risk_pct}%`), h("dd", {}, sar(T.risk)), h("dt", {}, `${t("Margin")} ${est.margin_pct}%`), h("dd", {}, sar(T.price - T.cost)),
            h("dt", {}, h("b", {}, t("Price excl. VAT"))), h("dd", {}, h("b", { class: "big2" }, sar(T.price))), h("dt", {}, t("Total incl. VAT")), h("dd", {}, sar(T.total)), h("dt", {}, t("Labour effort")), h("dd", {}, `${nf(T.labor_days)} ${t("crew-days")}`)))),
          h("div", { class: "card" }, h("div", { class: "hd" }, ic("bot"), h("h2", {}, t("How it was priced"))), h("div", { class: "bd" }, trace(est.trace, { animate }))),
          h("button", { class: "btn primary", onclick: async () => { try { const r = await rpc("estimates.save", { client: client.value, title: title.value, text: text.value, lines: est.lines, overhead_pct: est.overhead_pct, risk_pct: est.risk_pct, margin_pct: est.margin_pct }); toast(t("Saved")); navigate(`#/estimate/${r.id}`); } catch (e) { toast(e.message, true); } } }, ic("check"), t("Save estimate")))));
  }
  return h("div", {},
    h("div", { class: "crumb" }, h("a", { href: "#/estimation" }, t("Estimation")), " / ", t("New")),
    h("div", { class: "topbar" }, h("div", {}, h("h1", {}, t("New estimate"))), h("button", { class: "btn", onclick: () => { text.value = SAMPLE; client.value = "Al-Aqeeq Healthcare (sample)"; title.value = "Al-Aqeeq Medical Center — MEP"; } }, t("Load a sample tender"))),
    h("div", { class: "card" }, h("div", { class: "bd col" }, h("div", { class: "form" }, h("label", { class: "f" }, h("span", {}, t("Client")), client), h("label", { class: "f" }, h("span", {}, t("Tender")), title)), text,
      h("div", { class: "row" }, h("label", { class: "f", style: { flexDirection: "row", alignItems: "center" } }, h("span", {}, t("Overhead %")), oh), h("label", { class: "f", style: { flexDirection: "row", alignItems: "center" } }, h("span", {}, t("Risk %")), rk), h("label", { class: "f", style: { flexDirection: "row", alignItems: "center" } }, h("span", {}, t("Margin %")), mg), h("span", { class: "sp" }),
        h("button", { class: "btn primary", onclick: build }, ic("bot"), t("Price it"))))),
    out);
}

async function view(id) {
  const e = await rpc("estimates.get", { id }); const T = e.totals; const can = ["owner", "estimator"].includes(app.session.user.role);
  return h("div", {},
    h("div", { class: "crumb" }, h("a", { href: "#/estimation" }, t("Estimation")), " / ", e.no),
    h("div", { class: "topbar" }, h("div", {}, h("h1", {}, e.title), h("div", { class: "small muted" }, `${e.no} · ${e.client} · ${fdate(e.created_at)}`)), h("span", { class: "sp" }), stChip(e.status),
      can ? h("select", { style: { width: "auto" }, onchange: async ev => { await rpc("estimates.status", { id: e.id, status: ev.target.value }); toast(t("Saved")); rerender(); } }, ...["draft", "submitted", "won", "lost"].map(s => h("option", { value: s, selected: s === e.status }, t(s)))) : null,
      h("button", { class: "btn", onclick: () => window.print() }, ic("print"), t("Print quotation"))),
    h("div", { class: "print-only print-head" }, h("div", {}, h("h2", {}, e.tenant.name_en), h("div", { class: "xs" }, `${e.tenant.name_ar} · CR ${e.tenant.cr_no} · VAT ${e.tenant.vat_no}`)), h("div", { style: { textAlign: "end" } }, h("b", {}, "QUOTATION " + e.no), h("div", { class: "xs" }, `${e.client} · ${fdate(e.created_at)}`))),
    h("div", { class: "grid g4" }, ...[[t("Direct cost"), sar(T.direct)], [t("Price excl. VAT"), sar(T.price)], [t("Total incl. VAT"), sar(T.total)], [t("Effective margin"), `${T.effective_margin}%`]].map(([l, v]) => h("div", { class: "card stat" }, h("div", { class: "lbl" }, l), h("div", { class: "val", style: { fontSize: "22px" } }, v)))),
    h("div", { class: "card", style: { marginTop: "14px" } }, table([{ l: "#", v: l => l.ref || "" }, { l: t("Description"), v: l => h("span", { dir: "auto" }, l.description) }, { l: t("Qty"), v: l => nf(l.qty), r: 1 }, { l: t("Unit"), v: l => l.unit }, { l: t("Rate"), v: l => nf(l.sell_rate, 2), r: 1 }, { l: t("Amount"), v: l => nf(l.sell_amount, 2), r: 1 }, { l: "", v: l => (l.flag ? chip(t("check"), "amber") : null) }], e.lines,
      { foot: h("tr", {}, h("td", { colSpan: 5, class: "r" }, h("b", {}, t("Total excl. VAT"))), h("td", { class: "r" }, h("b", {}, nf(T.price, 2))), h("td", {})) })),
    h("p", { class: "xs faint", style: { marginTop: "10px" } }, t("Rates from the company cost database (material + labour + equipment), plus overhead, risk and margin. Demo data.")));
}
