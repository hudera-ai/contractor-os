// Procurement agent: requests → RFQ → scored quotes → award (with approval above the limit) → PO → delivery.
import { h, ic, table, toast, modal, chip, progressBar } from "../ui.js";
import { t, LANG, fdate, ago, nf } from "../i18n.js";
import { rpc, app, navigate, rerender, updateBadges } from "../main.js";
import { stChip, pname, sar } from "./common.js";

export async function procurement(app_, route) {
  if (route.name === "mr" && route.id) return detail(route.id);
  const list = await rpc("procurement.list", { status: route.params.status || "" });
  const canCreate = ["owner", "procurement", "pm", "site_engineer"].includes(app.session.user.role);
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Procurement")), h("h1", {}, t("Material requests & purchase orders"))),
      h("a", { class: "btn", href: "#/settings?tab=suppliers" }, t("Suppliers")), canCreate ? h("button", { class: "btn primary", onclick: newRequest }, ic("plus"), t("New request")) : null),
    h("p", { class: "muted small", style: { marginBottom: "12px" } }, t("Requests arrive from site messages or are created here. The procurement agent picks suppliers by category, collects quotes, scores them on price, delivery against the needed-by date and reliability, and recommends one. POs above the approval limit go to the owner.")),
    h("div", { class: "card" }, table([
      { l: t("Request"), v: m => h("div", {}, h("code", {}, m.no), h("div", { class: "xs muted" }, ago(m.created_at))) }, { l: t("Project"), v: m => h("span", { class: "small" }, `${m.code} · ${pname(m)}`) },
      { l: t("Requested by"), v: m => m.requested_by }, { l: t("Items"), v: m => m.items, r: 1 }, { l: t("Quotes"), v: m => m.quotes, r: 1 }, { l: t("Best offer"), v: m => (m.best_total ? sar(m.best_total) : "—"), r: 1 },
      { l: t("Needed by"), v: m => fdate(m.needed_by) }, { l: t("Status"), v: m => stChip(m.status) }], list, { onRow: m => navigate(`#/mr/${m.id}`) })));
}

async function newRequest() {
  const [cat, s] = [await rpc("catalog.list"), app.session];
  const proj = h("select", {}, ...s.projects.map(p => h("option", { value: p.id }, `${p.code} · ${LANG === "ar" ? p.name_ar : p.name_en}`)));
  const need = h("input", { type: "date", value: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) });
  const rows = h("div", { class: "col" }); const add = () => rows.append(h("div", { class: "step-row" }, h("select", {}, ...cat.map(c => h("option", { value: c.id }, `${c.code} · ${LANG === "ar" ? c.name_ar : c.name_en} (${c.unit})`))), h("input", { type: "number", value: 10, style: { maxWidth: "110px" } }), h("button", { class: "btn sm ghost", onclick: e => e.target.closest(".step-row").remove() }, ic("trash"))));
  add();
  modal(t("New material request"), h("div", { class: "col" }, h("div", { class: "form" }, h("label", { class: "f" }, h("span", {}, t("Project")), proj), h("label", { class: "f" }, h("span", {}, t("Needed by")), need)), rows, h("button", { class: "btn sm", onclick: add }, ic("plus"), t("Add item"))),
    [{ label: t("Cancel") }, { label: t("Create & send RFQ"), cls: "primary", onClick: async () => {
      try { const items = [...rows.children].map(r => ({ catalog_id: +r.querySelector("select").value, qty: +r.querySelector("input").value })); const r = await rpc("procurement.create", { project_id: +proj.value, needed_by: need.value, items });
        try { await rpc("procurement.rfq", { id: r.id, lang: LANG }); } catch {} toast(t("Request created")); navigate(`#/mr/${r.id}`); } catch (e) { toast(e.message, true); return false; } } }]);
}

async function detail(id) {
  const m = await rpc("procurement.get", { id });
  const canBuy = ["owner", "procurement"].includes(app.session.user.role);
  const award = q => {
    const reason = h("textarea", { rows: 2, placeholder: q.recommended ? t("Optional note") : t("Why this supplier instead of the recommended one? (required)") });
    modal(t("Award to {s}", { s: q.supplier }), h("div", { class: "col" }, h("p", { class: "small" }, `${sar(q.total)} ${t("incl. VAT")} · ${q.lead_days} ${t("days")}`), q.total > m.limit && app.session.user.role !== "owner" ? h("div", { class: "banner" }, ic("hand"), t("Above {l} — the owner must approve before the PO is issued.", { l: sar(m.limit) })) : null, reason),
      [{ label: t("Cancel") }, { label: t("Award"), cls: "primary", onClick: async () => { try { const r = await rpc("procurement.award", { id: m.id, quote_id: q.id, reason: reason.value }); toast(r.status === "po_issued" ? t("PO {n} issued", { n: r.po.no }) : t("Sent to the owner for approval")); updateBadges(); rerender(); } catch (e) { toast(e.message, true); return false; } } }]);
  };
  const best = m.quotes.find(q => q.recommended);
  return h("div", {},
    h("div", { class: "crumb" }, h("a", { href: "#/procurement" }, t("Procurement")), " / ", m.no),
    h("div", { class: "topbar" }, h("div", {}, h("h1", {}, `${m.no} · ${m.code}`), h("div", { class: "small muted" }, `${pname(m)} · ${t("requested by")} ${m.requested_by} · ${t("needed by")} ${fdate(m.needed_by)}`)), h("span", { class: "sp" }), stChip(m.status),
      canBuy && !["po_issued", "delivered"].includes(m.status) ? h("button", { class: "btn", onclick: async () => { await rpc("procurement.rfq", { id: m.id, lang: LANG }); toast(t("RFQ re-sent; quotes refreshed")); rerender(); } }, ic("refresh"), t("Re-send RFQ")) : null),
    m.message ? h("div", { class: "card", style: { marginBottom: "14px" } }, h("div", { class: "bd row", style: { flexWrap: "nowrap" } }, h("span", { class: "ti" }, ic("chat")), h("div", {}, h("div", { class: "xs muted" }, `${t("From site")} · ${m.message.sender_name} · ${fdate(m.message.at, true)}`), h("div", { class: "small", dir: "auto" }, m.message.body)))) : null,
    h("div", { class: "grid", style: { gridTemplateColumns: "1fr 2fr" }, "data-r": "stack" },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Items"))), table([{ l: t("Item"), v: i => h("div", {}, h("b", { class: "small" }, i.description), h("div", { class: "xs muted" }, `${i.cat_code || ""} · ${i.category || ""}`)) }, { l: t("Qty"), v: i => `${nf(i.qty)} ${i.unit}`, r: 1 }], m.items)),
      h("div", { class: "card" }, h("div", { class: "hd" }, ic("bot"), h("h2", {}, t("Quote comparison")), h("span", { class: "sp" }), h("span", { class: "xs muted" }, t("score = price 55 · delivery 25 · reliability 20 − missing items"))),
        m.quotes.length ? h("div", { class: "quotes" }, ...m.quotes.map(q => h("div", { class: `quote ${q.recommended ? "best" : ""}` },
          h("div", { class: "row" }, h("b", {}, q.supplier), q.recommended ? chip(t("Recommended"), "green") : null, h("span", { class: "sp" }), h("b", { class: "big2" }, sar(q.total))),
          h("div", { class: "xs muted" }, `${q.city} · ${t("rating")} ${q.rating}/5 · ${t("on-time")} ${Math.round(q.on_time_rate * 100)}% · ${q.payment_terms} · ${t("valid until")} ${fdate(q.valid_until)}`),
          h("div", { class: "scorebar" }, ...["price", "delivery", "reliability"].map((k, i) => h("i", { class: `s${i}`, style: { width: `${Math.max(0, q.reasons.parts?.[k] || 0)}%` }, title: `${k} ${q.reasons.parts?.[k]}` })), h("span", { class: "xs" }, `${nf(q.score, 1)}`)),
          h("ul", { class: "xs reasons" }, ...(q.reasons.reasons || []).map(r => h("li", {}, r))),
          canBuy && ["quoted"].includes(m.status) ? h("button", { class: `btn sm ${q.recommended ? "primary" : ""}`, onclick: () => award(q) }, t("Award")) : null)))
          : h("div", { class: "empty" }, t("No quotes yet")))),
    m.approval ? h("div", { class: "banner", style: { marginTop: "14px" } }, ic("hand"), `${t("Approval")}: ${t(m.approval.status)} · ${sar(m.approval.amount)}${m.approval.comment ? " · " + m.approval.comment : ""}`) : null,
    m.po ? h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, ic("card"), h("h2", {}, `${t("Purchase order")} ${m.po.no}`), h("span", { class: "sp" }), stChip(m.po.status),
      h("button", { class: "btn sm", onclick: () => printPo(m) }, ic("print"), t("Print PO")),
      m.po.status === "issued" ? h("button", { class: "btn sm primary", onclick: async () => { await rpc("procurement.deliver", { po_id: m.po.id }); toast(t("Delivered — cost booked to the project")); rerender(); } }, ic("check"), t("Mark delivered")) : null),
      h("div", { class: "bd small" }, `${m.po.supplier} · ${sar(m.po.total)} · ${t("issued")} ${fdate(m.po.issued_at)} · ${t("expected")} `, h("b", { class: m.po.status === "issued" && m.po.expected_at < new Date().toISOString().slice(0, 10) ? "warn-t" : "" }, fdate(m.po.expected_at)))) : null);
}

function printPo(m) {
  const q = m.quotes.find(x => x.id === m.po.quote_id) || m.quotes[0]; const s = app.session.tenant;
  const w = window.open("", "_blank"); if (!w) return;
  w.document.write(`<html dir="ltr"><head><title>${m.po.no}</title><style>body{font-family:system-ui;margin:32px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:left}th{background:#f3f3f3}.r{text-align:right}h1{margin:0}small{color:#666}</style></head><body>
  <div style="display:flex;justify-content:space-between"><div><h1>PURCHASE ORDER</h1><small>${s.name_en} · ${s.name_ar}<br>CR ${s.cr_no} · VAT ${s.vat_no}</small></div><div style="text-align:right"><b>${m.po.no}</b><br>${m.po.issued_at.slice(0, 10)}<br>Project ${m.code}</div></div>
  <p><b>Supplier:</b> ${q.supplier}<br><b>Deliver by:</b> ${m.po.expected_at} · <b>Payment:</b> ${q.payment_terms}<br><b>Ref:</b> ${m.no}</p>
  <table><tr><th>Item</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">Amount</th></tr>${q.lines.map(l => `<tr><td>${l.description}</td><td class="r">${l.qty}</td><td>${l.unit}</td><td class="r">${l.rate ?? "—"}</td><td class="r">${l.amount.toLocaleString("en-US")}</td></tr>`).join("")}
  <tr><td colspan="4" class="r">Subtotal</td><td class="r">${q.subtotal.toLocaleString("en-US")}</td></tr><tr><td colspan="4" class="r">VAT 15%</td><td class="r">${q.vat.toLocaleString("en-US")}</td></tr><tr><td colspan="4" class="r"><b>Total SAR</b></td><td class="r"><b>${q.total.toLocaleString("en-US")}</b></td></tr></table>
  <p style="margin-top:40px"><small>Demo document generated by HUDERA Contractor OS on sample data.</small></p><script>print()</script></body></html>`); w.document.close();
}
