import { h, ic, lineChart, table, chip } from "../ui.js";
import { t, LANG, nf, ago } from "../i18n.js";
import { rpc, navigate } from "../main.js";
import { healthChip, kindChip, stChip, pname, sar, ksar, dualBar, idx } from "./common.js";

export async function dashboard() {
  const d = await rpc("dashboard.summary");
  const stat = (l, v, s) => h("div", { class: "card stat" }, h("div", { class: "lbl" }, l), h("div", { class: "val" }, v), s ? h("div", { class: "sub" }, s) : null);
  const ask = h("input", { placeholder: t("Ask anything — e.g. “إيه المشاريع المتأخرة؟” or “which projects are over budget?”"), onkeydown: e => { if (e.key === "Enter" && e.target.value.trim()) navigate(`#/ask?q=${encodeURIComponent(e.target.value)}`); } });
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Overview")), h("h1", {}, t("Portfolio at a glance"))), h("a", { class: "btn", href: "#/field" }, ic("inbox"), t("Field inbox")), h("a", { class: "btn primary", href: "#/ask" }, ic("bot"), t("Ask the AI PM"))),
    h("div", { class: "card askbar" }, h("div", { class: "bd row", style: { flexWrap: "nowrap" } }, h("span", { class: "ti" }, ic("bot")), ask, h("button", { class: "btn primary", onclick: () => ask.value.trim() && navigate(`#/ask?q=${encodeURIComponent(ask.value)}`) }, t("Ask")))),
    h("div", { class: "grid g4", style: { marginTop: "14px" } },
      stat(t("Contract value"), ksar(d.contract), `${d.projects.length} ${t("active projects")}`),
      stat(t("Work done"), `${nf(100 * d.ev / Math.max(1, d.bac), 1)}%`, h("span", {}, t("planned"), ` ${nf(100 * d.pv / Math.max(1, d.bac), 1)}% · SPI `, idx(d.spi))),
      stat(t("Cost vs work"), h("span", {}, "CPI ", idx(d.cpi)), `${t("spent")} ${ksar(d.ac)} · ${t("earned")} ${ksar(d.ev)}`),
      stat(t("Cash"), ksar(d.billed - d.collected), h("span", {}, t("unpaid client invoices"), d.overdue_receivables ? h("b", { class: "warn-t" }, ` · ${ksar(d.overdue_receivables)} ${t("overdue")}`) : null))),
    h("div", { class: "grid", style: { gridTemplateColumns: "1.3fr 1fr", marginTop: "14px" }, "data-r": "stack" },
      h("div", { class: "card" }, h("div", { class: "hd" }, ic("bot"), h("h2", {}, t("AI PM — what needs you this week")), h("span", { class: "sp" }), h("a", { class: "btn ghost sm", href: `#/ask?q=${encodeURIComponent(LANG === "ar" ? "أولويات الأسبوع" : "priorities this week")}` }, t("Explain"))),
        h("div", { class: "prio" }, ...(d.priorities.length ? d.priorities : [["", "", t("No high risks right now")]]).map(r => h("div", { class: "pi" }, r[0] ? chip(r[0], /high|عالية/.test(r[0]) ? "red" : "amber", false) : null, h("b", { class: "mono small" }, r[1]), h("span", { class: "small", dir: "auto" }, r[2]))))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Earned value vs cost (SAR k, all projects)")), h("span", { class: "sp" }), h("div", { class: "legend" }, h("span", {}, h("i", { style: { background: "var(--chart-2)" } }), t("earned")), h("span", {}, h("i", { style: { background: "var(--chart-1)" } }), t("cost")))),
        h("div", { class: "bd" }, lineChart([{ name: "cost", points: d.costByWeek }, { name: "earned", points: d.earnedByWeek, area: true }], { height: 200 })))),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, h("h2", {}, t("Projects")), h("span", { class: "sp" }), h("a", { class: "btn ghost sm", href: "#/projects" }, t("All projects"))),
      table([
        { l: t("Project"), v: p => h("div", {}, h("b", { class: "small", style: { color: "var(--ink)" } }, `${p.code} · ${pname(p)}`), h("div", { class: "xs muted" }, `${p.client} · ${t("PM")}: ${p.pm_name || "—"}`)) },
        { l: t("Done vs planned"), v: p => h("div", { style: { minWidth: "150px" } }, dualBar(p.stats.progress, p.stats.planned), h("div", { class: "xs muted" }, `${p.stats.progress}% / ${p.stats.planned}%`)) },
        { l: "SPI", v: p => idx(p.stats.spi), r: 1 }, { l: "CPI", v: p => idx(p.stats.cpi), r: 1 }, { l: "RFIs", v: p => p.stats.open_rfis, r: 1 },
        { l: t("Manpower"), v: p => p.stats.manpower_today, r: 1 }, { l: t("Health"), v: p => healthChip(p.health) }], d.projects, { onRow: p => navigate(`#/project/${p.id}`) })),
    h("div", { class: "card", style: { marginTop: "14px" } }, h("div", { class: "hd" }, ic("inbox"), h("h2", {}, t("Latest from site")), h("span", { class: "sp" }), h("a", { class: "btn ghost sm", href: "#/field" }, t("Field inbox"))),
      h("div", { class: "feed" }, ...d.recent.map(m => h("a", { class: "fi", href: `#/field?id=${m.id}`, style: { textDecoration: "none" } }, kindChip(m.kind), h("div", { style: { minWidth: 0, flex: 1 } }, h("div", { class: "small clamp", dir: "auto", style: { color: "var(--ink)" } }, m.body), h("div", { class: "xs muted" }, `${m.sender_name} · ${m.code || t("no project")} · ${ago(m.at)}`)), stChip(m.status))))));
}
