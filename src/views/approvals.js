import { h, ic, toast, modal, chip } from "../ui.js";
import { t, LANG, fdate, ago } from "../i18n.js";
import { rpc, app, navigate, rerender, updateBadges } from "../main.js";
import { stChip, sar } from "./common.js";
export async function approvals(app_, route) {
  const status = route.params.status || "pending"; const list = await rpc("approvals.list", { status });
  const decide = (a, st) => { const ta = h("textarea", { rows: 2 }); modal(st === "approved" ? t("Approve") : t("Reject"), h("div", { class: "col" }, h("p", { class: "small" }, a.title[LANG] || a.title.en), h("label", { class: "f" }, h("span", {}, t("Comment")), ta)), [{ label: t("Cancel") }, { label: st === "approved" ? t("Approve") : t("Reject"), cls: st === "approved" ? "primary" : "danger", onClick: async () => { try { const r = await rpc("approvals.decide", { id: a.id, status: st, comment: ta.value }); toast(r.po ? t("PO {n} issued", { n: r.po.no }) : t("Done")); updateBadges(); rerender(); } catch (e) { toast(e.message, true); return false; } } }]); };
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Approvals")), h("h1", {}, t("Decisions for you"))), h("div", { class: "seg" }, ...["pending", "approved", "rejected", "all"].map(s => h("button", { class: status === s ? "on" : "", onclick: () => navigate(`#/approvals?status=${s}`) }, t(s))))),
    list.length ? h("div", { class: "col" }, ...list.map(a => { const d = a.detail; const q = d?.quotes?.find(x => x.id === a.title.quote_id);
      return h("div", { class: "card appr" }, h("div", { class: "hd" }, h("span", { class: "ti" }, ic("card")), h("div", {}, h("h2", {}, a.title[LANG] || a.title.en), h("div", { class: "xs muted" }, `${t("Purchase order")} · ${ago(a.created_at)}`)), h("span", { class: "sp" }), h("b", {}, sar(a.amount)), stChip(a.status)),
        d ? h("div", { class: "bd small col", style: { gap: "6px" } }, h("div", {}, `${d.code} · ${d.items.map(i => `${i.description} × ${i.qty} ${i.unit}`).join(" · ")}`),
          q ? h("div", {}, `${q.supplier} · ${q.lead_days} ${t("days")} · ${t("score")} ${q.score}${q.recommended ? " · " + t("Recommended") : ""}`) : null,
          h("div", { class: "xs muted" }, `${t("Other quotes")}: ${d.quotes.filter(x => x.id !== q?.id).map(x => `${x.supplier} ${sar(x.total)}`).join(" · ") || "—"}`), a.reason ? h("div", { class: "xs" }, `${t("Reason")}: ${a.reason}`) : null) : null,
        a.status === "pending" ? h("div", { class: "ft" }, a.can_decide ? [h("button", { class: "btn primary", onclick: () => decide(a, "approved") }, ic("check"), t("Approve")), h("button", { class: "btn danger", onclick: () => decide(a, "rejected") }, ic("x"), t("Reject"))] : h("span", { class: "xs muted" }, t("Only the owner can approve this.")), h("span", { class: "sp" }), h("a", { class: "btn sm ghost", href: `#/mr/${a.ref_id}` }, t("Open request")))
          : h("div", { class: "ft xs muted" }, `${t(a.status)} · ${a.decided_by_name || ""} · ${fdate(a.decided_at, true)}${a.comment ? " · " + a.comment : ""}`)); }))
      : h("div", { class: "card" }, h("div", { class: "empty" }, ic("check"), h("div", {}, t("Nothing waiting for you.")))));
}
