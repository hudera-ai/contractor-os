import { h, ic, table, lineChart, barChart, chip, modal, toast } from "../ui.js";
import { t, LANG, nf, fdate, ago } from "../i18n.js";
import { rpc, navigate, rerender, app } from "../main.js";
import { healthChip, kindChip, stChip, pname, sar, ksar, dualBar, idx, trace } from "./common.js";

export async function projects(app_, route) {
  if (route.name === "project" && route.id) return detail(route);
  const list = await rpc("projects.list");
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Projects")), h("h1", {}, t("Projects")))),
    h("div", { class: "grid g3" }, ...list.map(p => h("a", { class: "card pcard", href: `#/project/${p.id}` }, h("div", { class: "bd col", style: { gap: "10px" } },
      h("div", { class: "row" }, h("code", { class: "small" }, p.code), h("span", { class: "sp" }), stChip(p.status), healthChip(p.health)),
      h("h3", { dir: "auto" }, pname(p)), h("div", { class: "xs muted" }, `${p.client} · ${p.city}`),
      dualBar(p.stats.progress, p.stats.planned), h("div", { class: "row xs muted" }, `${t("done")} ${p.stats.progress}%`, h("span", { class: "sp" }), `${t("planned")} ${p.stats.planned}%`),
      h("div", { class: "mini3" }, h("div", {}, h("b", {}, nf(p.stats.spi, 2)), h("span", {}, "SPI")), h("div", {}, h("b", {}, nf(p.stats.cpi, 2)), h("span", {}, "CPI")), h("div", {}, h("b", {}, ksar(p.contract_value)), h("span", {}, t("contract")))),
      h("div", { class: "xs muted" }, `${t("Site engineer")}: ${p.engineer_name || "—"} · ${p.stats.open_rfis} RFIs · ${p.stats.pending_mrs} ${t("open requests")}`))))));
}

async function detail(route) {
  const p = await rpc("projects.get", { id: route.id }); const s = p.stats; const tab = route.params.tab || "overview";
  const canPm = ["owner", "pm"].includes(app.session.user.role);
  const tabs = [["overview", "Overview"], ["field", "Field log"], ["rfis", `RFIs (${p.rfis.filter(r => r.status === "open").length})`], ["procurement", "Materials"], ["money", "Costs & invoices"], ["issues", "Delays & safety"]];
  const stat = (l, v, sub) => h("div", { class: "card stat" }, h("div", { class: "lbl" }, l), h("div", { class: "val" }, v), sub ? h("div", { class: "sub" }, sub) : null);
  let content;
  if (tab === "overview") content = h("div", {},
    h("div", { class: "grid g4" }, stat(t("Done / planned"), `${s.progress}%`, `${t("planned")} ${s.planned}% · SPI ${s.spi}`), stat(t("Cost performance"), h("span", {}, "CPI ", idx(s.cpi)), `${t("spent")} ${ksar(s.ac)} · ${t("earned")} ${ksar(s.ev)}`),
      stat(t("Forecast at completion"), ksar(s.eac), h("span", { class: s.margin_forecast < 0 ? "warn-t" : "" }, `${t("margin")} ${ksar(s.margin_forecast)}`)), stat(t("Forecast delay"), `${s.forecast_delay_days} ${t("days")}`, `${t("finish")} ${fdate(p.end_date)}`)),
    h("div", { class: "grid", style: { gridTemplateColumns: "1.4fr 1fr", marginTop: "14px" }, "data-r": "stack" },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("S-curve (% of budget)")), h("span", { class: "sp" }), h("div", { class: "legend" }, ...[["planned", 1], ["earned", 2], ["actual cost", 3]].map(([l, i]) => h("span", {}, h("i", { style: { background: `var(--chart-${i})` } }), t(l))))),
        h("div", { class: "bd" }, lineChart([{ name: "planned", points: p.curve.planned }, { name: "earned", points: p.curve.earned, area: true }, { name: "actual", points: p.curve.actual }], { height: 210, pct: true }))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Manpower (last 3 weeks)"))), h("div", { class: "bd" }, barChart(p.manpower.map(m => ({ l: m.date.slice(8), v: m.n, color: "var(--chart-2)" })), { height: 210 })))),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, h("h2", {}, t("Activities"))),
      table([{ l: t("Activity"), v: a => h("div", {}, h("b", { class: "small" }, `${a.code} · ${LANG === "ar" ? a.name_ar : a.name_en}`), h("div", { class: "xs muted" }, `${fdate(a.planned_start)} → ${fdate(a.planned_end)}`)) },
        { l: t("Done vs planned"), v: a => h("div", { style: { minWidth: "160px" } }, dualBar(Math.round(a.pct * 100), Math.round(a.planned_pct * 100)), h("div", { class: "xs muted" }, `${Math.round(a.pct * 100)}% / ${Math.round(a.planned_pct * 100)}%`)) },
        { l: t("Executed"), v: a => `${nf(a.done)} / ${nf(a.qty)} ${a.unit}`, r: 1 }, { l: t("Budget"), v: a => ksar(a.budget_cost), r: 1 }, { l: "", v: a => a.behind ? chip(t("behind"), "red") : chip(t("on track"), "green") }], s.activities)));
  if (tab === "field") content = h("div", { class: "col" }, ...p.messages.map(m => h("div", { class: "card" }, h("div", { class: "hd" }, kindChip(m.kind), h("b", { class: "small" }, m.sender_name), h("span", { class: "xs muted" }, fdate(m.at, true)), h("span", { class: "sp" }), stChip(m.status)),
    h("div", { class: "bd grid g2" }, h("div", { class: "col" }, h("div", { class: "msgbody", dir: "auto" }, m.body), m.reply ? h("div", { class: "xs muted", dir: "auto" }, "↩ ", m.reply) : null), trace(m.trace)))), p.messages.length ? null : h("div", { class: "empty" }, t("No messages yet")));
  if (tab === "rfis") content = h("div", { class: "card" }, table([{ l: "RFI", v: r => h("code", {}, r.no) }, { l: t("Subject"), v: r => h("div", { dir: "auto" }, h("b", { class: "small" }, r.subject), r.answer ? h("div", { class: "xs muted" }, "↳ ", r.answer) : null) }, { l: t("Discipline"), v: r => r.discipline }, { l: t("Location"), v: r => r.location || "—" },
    { l: t("Due"), v: r => h("span", { class: r.status === "open" && r.due_at < new Date().toISOString().slice(0, 10) ? "warn-t" : "" }, fdate(r.due_at)) }, { l: t("Status"), v: r => stChip(r.status) },
    { l: "", v: r => canPm && r.status === "open" ? h("button", { class: "btn sm", onclick: () => { const ta = h("textarea", { rows: 3 }); modal(r.no, h("div", { class: "col" }, h("p", { class: "small", dir: "auto" }, r.question), h("label", { class: "f" }, h("span", {}, t("Consultant's answer")), ta)), [{ label: t("Cancel") }, { label: t("Save"), cls: "primary", onClick: async () => { await rpc("rfis.answer", { id: r.id, answer: ta.value }); toast(t("Saved")); rerender(); } }]); } }, t("Record answer")) : null }], p.rfis));
  if (tab === "procurement") content = h("div", { class: "card" }, table([{ l: t("Request"), v: m => h("code", {}, m.no) }, { l: t("Requested by"), v: m => m.requested_by }, { l: t("Needed by"), v: m => fdate(m.needed_by) }, { l: "PO", v: m => m.po_no || "—" }, { l: t("Status"), v: m => stChip(m.status) }], p.mrs, { onRow: m => navigate(`#/mr/${m.id}`) }));
  if (tab === "money") {
    const months = [...new Set(p.months.map(m => m.m))];
    content = h("div", { class: "grid g2" },
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Monthly cost (SAR k)"))), h("div", { class: "bd" }, barChart(months.map(m => ({ l: m.slice(2), v: Math.round(p.months.filter(x => x.m === m).reduce((a, x) => a + x.s, 0) / 1000) })), { height: 200 }))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Client invoices"))), table([{ l: t("Invoice"), v: i => h("code", {}, i.no) }, { l: t("Amount"), v: i => sar(i.amount), r: 1 }, { l: t("Due"), v: i => fdate(i.due_date) }, { l: t("Status"), v: i => i.status === "issued" && i.due_date < new Date().toISOString().slice(0, 10) ? chip(t("overdue"), "red") : stChip(i.status) }], p.invoices)));
  }
  if (tab === "issues") content = h("div", { class: "card" }, table([{ l: t("When"), v: i => fdate(i.at, true) }, { l: t("Type"), v: i => chip(t(i.kind), i.kind === "safety" ? "red" : "amber") }, { l: t("Description"), v: i => h("span", { class: "small", dir: "auto" }, i.description) }, { l: t("Cause"), v: i => i.cause || "—" }, { l: t("Severity"), v: i => t(i.severity) }, { l: t("Status"), v: i => stChip(i.status) },
    { l: "", v: i => canPm && i.status === "open" ? h("button", { class: "btn sm", onclick: async () => { await rpc("incidents.close", { id: i.id }); toast(t("Closed")); rerender(); } }, t("Close")) : null }], p.incidents));
  return h("div", {},
    h("div", { class: "crumb" }, h("a", { href: "#/projects" }, t("Projects")), " / ", p.code),
    h("div", { class: "topbar" }, h("div", {}, h("h1", { dir: "auto" }, pname(p)), h("div", { class: "small muted" }, `${p.code} · ${p.client} · ${t("Consultant")}: ${p.consultant} · ${t("PM")}: ${p.pm?.name || "—"} · ${t("Site engineer")}: ${p.engineer?.name || "—"}`)), h("span", { class: "sp" }), healthChip(p.health),
      h("a", { class: "btn primary", href: `#/ask?q=${encodeURIComponent((LANG === "ar" ? "وضع مشروع " : "status of ") + p.code)}` }, ic("bot"), t("Ask about this project"))),
    h("div", { class: "tabs" }, ...tabs.map(([k, l]) => h("a", { href: `#/project/${p.id}?tab=${k}`, class: tab === k ? "on" : "" }, t(l.replace(/ \(\d+\)$/, "")) + (l.match(/ \(\d+\)$/)?.[0] || "")))), content);
}
