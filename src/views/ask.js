// Ask the AI PM: questions in Arabic or English, answered from live project data with the working shown.
import { h, ic, table, barChart, toast } from "../ui.js";
import { t, LANG, ago } from "../i18n.js";
import { rpc, app } from "../main.js";
import { trace } from "./common.js";

const SUGGEST = { ar: ["إيه المشاريع المتأخرة؟", "أي مشاريع متجاوزة الميزانية؟", "وش أولويات هالأسبوع؟", "كم صرفنا على برج الياسمين؟", "الاستفسارات المفتوحة عند الاستشاري", "المستخلصات المتأخرة", "وضع مشروع P-2403"],
  en: ["Which projects are behind schedule?", "Which projects are over budget?", "What should I focus on this week?", "Materials pending delivery", "Manpower today", "Status of Noor clinic", "Safety incidents"] };

export async function ask(app_, route) {
  const thread = h("div", { class: "ask-thread" });
  const input = h("input", { placeholder: t("Ask about your projects…"), onkeydown: e => { if (e.key === "Enter") go(); } });
  async function go(q = input.value) {
    q = String(q || "").trim(); if (!q) return; input.value = "";
    thread.append(h("div", { class: "q", dir: "auto" }, q)); const wait = h("div", { class: "a" }, h("span", { class: "spinner" })); thread.append(wait); wait.scrollIntoView({ block: "end", behavior: "smooth" });
    try {
      const [r] = await Promise.all([rpc("ask", { question: q }), new Promise(ok => setTimeout(ok, 450))]);
      const showTrace = h("details", { class: "why" }, h("summary", {}, ic("flow"), t("How this was calculated")), trace(r.trace));
      wait.replaceWith(h("div", { class: "a card" }, h("div", { class: "bd col" },
        h("div", { class: "row" }, h("span", { class: "ti" }, ic("bot")), h("b", { class: "small" }, t("AI project manager")), h("span", { class: "chip" }, t("intent_" + r.intent)), h("span", { class: "sp" }), h("span", { class: "xs faint" }, r.projects.join(" · "))),
        h("div", { class: "atext", dir: "auto" }, r.text),
        r.chart?.items?.length ? h("div", { class: "ask-chart" }, h("div", { class: "xs muted" }, r.chart.label), barChart(r.chart.items, { height: 150 })) : null,
        r.table?.rows?.length ? table(r.table.cols.map((c, i) => ({ l: c, v: row => row[i] })), r.table.rows) : null, showTrace)));
      thread.lastChild.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch (e) { wait.remove(); toast(e.message, true); }
  }
  const hist = await rpc("ask.history");
  setTimeout(() => { if (route.params.q) go(route.params.q); });
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Ask the AI PM")), h("h1", {}, t("Your AI project manager"))), h("span", { class: "chip violet" }, ic("bot"), t("Answers from live data · shows its working"))),
    h("div", { class: "card askbar" }, h("div", { class: "bd row", style: { flexWrap: "nowrap" } }, h("span", { class: "ti" }, ic("bot")), input, h("button", { class: "btn primary", onclick: () => go() }, t("Ask")))),
    h("div", { class: "suggest" }, ...[...SUGGEST[LANG], ...SUGGEST[LANG === "ar" ? "en" : "ar"].slice(0, 3)].map(s => h("button", { class: "smp", dir: "auto", onclick: () => go(s) }, s))),
    thread,
    hist.length ? h("div", { class: "card", style: { marginTop: "18px" } }, h("div", { class: "hd" }, h("h2", {}, t("Recently asked"))), h("div", { class: "feed" }, ...hist.slice(0, 8).map(q => h("button", { class: "fi run-row", onclick: () => go(q.question) }, h("span", { class: "small", dir: "auto", style: { flex: 1, color: "var(--ink)" } }, q.question), h("span", { class: "xs muted" }, `${q.name || ""} · ${ago(q.at)}`))))) : null);
}
