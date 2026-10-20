// Field inbox: WhatsApp messages from site → the field agent turns them into records and routes them.
import { h, ic, toast, chip } from "../ui.js";
import { t, LANG, fdate, ago, nf } from "../i18n.js";
import { rpc, app, navigate, updateBadges } from "../main.js";
import { trace, kindChip, stChip } from "./common.js";

const SAMPLES = {
  ar: [["Progress + manpower", "اليوم في برج الياسمين ركبنا 150 م2 دكت و 10 فان كويل في الدور 8. العمالة 12 دكت و 5 مساعدين"], ["Material request", "نحتاج 400 متر كيبل 4x16 و 30 كشاف LED لمبنى المكاتب B قبل يوم الخميس"],
    ["RFI", "في تعارض بين ماسورة الحريق والكمرة في الدور 4 بمدرسة الملقا، نرفع الماسورة ولا نلف حولها؟"], ["Delay", "توقف تركيب اللوحات في مبنى المكاتب لأن الاستشاري ما اعتمد المخططات، متأخرين 3 أيام"],
    ["Safety", "حادث بسيط في عيادات النور: فني انجرح في يده أثناء قص الصاج، تم إسعافه في الموقع"], ["No project named", "خلصنا 40 رشاش اليوم"]],
  en: [["Progress (English)", "Noor clinic today: 120 m fire fighting pipe and 60 sprinklers installed on level 3. Manpower 10 fitters, 5 helpers."], ["Request (English)", "Need 200 m cable tray 300mm and 15 distribution boards for Office Building B by Sunday"],
    ["RFI (English)", "Drawing conflict at Malqa school level 2: chilled water pipe clashes with the cable tray route. Which one goes on top?"], ["% progress", "P-2404 cable pulling 35% done this week"]],
};

export async function field(app_, route) {
  const [list, senders] = await Promise.all([rpc("field.list", { status: route.params.status || "" }), rpc("field.senders")]);
  let sel = list.find(m => m.id === +route.params.id) || list[0];
  const canPm = ["owner", "pm"].includes(app.session.user.role);
  const meIdx = senders.findIndex(s => s.id === app.session.user.id);
  let sender = senders[app.session.user.role === "site_engineer" && meIdx >= 0 ? meIdx : 0];
  const listBox = h("div", { class: "fm-list" }), detailBox = h("div", {}), chat = h("div", { class: "wa-body" });
  const input = h("textarea", { rows: 1, placeholder: t("Type a site message…"), onkeydown: e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } } });
  let lastResult = null;

  function drawList() {
    listBox.replaceChildren(...list.map(m => h("button", { class: `fm ${sel?.id === m.id ? "on" : ""}`, onclick: () => { sel = m; lastResult = null; drawList(); drawDetail(); } },
      h("div", { class: "row", style: { gap: "6px" } }, kindChip(m.kind), m.code ? h("code", { class: "xs" }, m.code) : chip(t("no project"), "amber", false), h("span", { class: "sp" }), stChip(m.status)),
      h("div", { class: "small clamp", dir: "auto" }, m.body), h("div", { class: "xs muted" }, `${m.sender_name} · ${ago(m.at)}`))));
  }
  function drawDetail(animate = false) {
    if (!sel) { detailBox.replaceChildren(h("div", { class: "empty" }, t("No messages yet"))); return; }
    const p = sel.parsed || {}; const c = p.created || lastResult?.created || {};
    const recs = [];
    for (const x of p.progress || []) recs.push(h("div", { class: "rec" }, ic("check"), `${x.code} · ${x.name}: +${nf(x.qty)} ${x.unit}`));
    if (p.manpower?.length) recs.push(h("div", { class: "rec" }, ic("user"), p.manpower.map(m => `${m.trade} ${m.count}`).join(" · ")));
    if (c.mr) recs.push(h("a", { class: "rec link", href: `#/mr/${c.mr.id}` }, ic("card"), `${t("Material request")} ${c.mr.no} → ${t("RFQ sent, quotes in")}`));
    if (c.rfi) recs.push(h("a", { class: "rec link", href: `#/project/${sel.project_id}?tab=rfis` }, ic("rep"), `${c.rfi.no} → ${t("PM / consultant")}`));
    if (c.incident) recs.push(h("a", { class: "rec link", href: `#/project/${sel.project_id}?tab=issues` }, ic("warn"), `${t(c.incident.kind)} ${t("logged")}`));
    const assign = sel.status === "needs_review" && canPm ? h("div", { class: "banner" }, ic("hand"), t("Which project is this?"), h("select", { style: { width: "auto" }, onchange: async e => { if (!e.target.value) return; const r = await rpc("field.assign", { id: sel.id, project_id: +e.target.value }); toast(t("Applied")); updateBadges(); navigate(`#/field?id=${sel.id}&t=${Date.now()}`); } },
      h("option", { value: "" }, "—"), ...app.session.projects.map(p => h("option", { value: p.id }, `${p.code} · ${LANG === "ar" ? p.name_ar : p.name_en}`)))) : null;
    detailBox.replaceChildren(...[
      h("div", { class: "row", style: { marginBottom: "10px" } }, kindChip(sel.kind), h("span", { class: "xs muted" }, `${t("confidence")} ${Math.round((sel.confidence || 0) * 100)}%`), h("span", { class: "sp" }), stChip(sel.status)),
      h("div", { class: "msgbody", dir: "auto" }, sel.body), h("div", { class: "xs muted", style: { margin: "4px 0 12px" } }, `${sel.sender_name} · ${fdate(sel.at, true)}`),
      assign, recs.length ? h("div", { class: "col", style: { gap: "6px", marginBottom: "12px" } }, h("b", { class: "xs muted" }, t("Records created")), ...recs) : null,
      sel.reply ? h("div", { class: "replybox", dir: "auto" }, h("b", { class: "xs" }, t("Reply sent to site")), h("div", {}, sel.reply)) : null,
      h("h3", { style: { margin: "14px 0 8px" } }, t("How the AI read it")), trace(sel.trace, { animate })].filter(Boolean));
  }
  function drawChat(msgs) { chat.replaceChildren(h("div", { class: "wa-day" }, t("Site group → Contractor OS")), ...msgs.map(([dir, body]) => h("div", { class: `bub ${dir}` }, h("div", { class: "tx", dir: "auto" }, body)))); chat.scrollTop = chat.scrollHeight; }
  const convo = [];
  async function send() {
    const text = input.value.trim(); if (!text) return; input.value = ""; convo.push(["in", text]); drawChat([...convo, ["out", "…"]]);
    try {
      const r = await rpc("field.send", { sender_id: sender.id, sender: sender.id ? null : { name: sender.name, phone: sender.phone }, text });
      convo.push(["out", r.reply]); drawChat(convo); lastResult = r;
      const fresh = await rpc("field.list", {}); list.splice(0, list.length, ...fresh); sel = list.find(m => m.id === r.id); drawList(); drawDetail(true); updateBadges();
    } catch (e) { convo.pop(); drawChat(convo); toast(e.message, true); }
  }
  const senderSel = h("select", { disabled: app.session.user.role === "site_engineer", onchange: e => { sender = senders[+e.target.value]; } }, ...senders.map((s, i) => h("option", { value: i, selected: s === sender }, `${s.name}${s.code ? " — " + s.code : ""}`)));
  drawList(); drawDetail(); drawChat([]);
  return h("div", {},
    h("div", { class: "topbar" }, h("div", {}, h("div", { class: "crumb" }, t("Field inbox")), h("h1", {}, t("From WhatsApp to records"))),
      h("div", { class: "seg" }, ...[["", "All"], ["needs_review", "needs_review"], ["applied", "applied"]].map(([v, l]) => h("button", { class: (route.params.status || "") === v ? "on" : "", onclick: () => navigate(`#/field?status=${v}`) }, t(l))))),
    h("div", { class: "field-grid" },
      h("div", { class: "col" }, h("div", { class: "phone short" }, h("div", { class: "wa-head" }, h("span", { class: "ti" }, ic("chat")), h("div", {}, h("b", {}, t("Send from site")), h("small", {}, t("as a site engineer on WhatsApp")))), h("div", { style: { padding: "8px", background: "#1F2C34" } }, senderSel), chat,
        h("div", { class: "wa-in" }, input, h("button", { class: "btn primary", onclick: send }, ic("send")))),
        h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Try these"))), h("div", { class: "bd samples" }, ...[...SAMPLES.ar, ...SAMPLES.en].map(([l, txt]) => h("button", { class: "smp", onclick: () => { input.value = txt; send(); } }, h("b", {}, t(l)), h("span", { dir: "auto" }, txt.length > 60 ? txt.slice(0, 60) + "…" : txt)))))),
      h("div", { class: "card" }, h("div", { class: "hd" }, h("h2", {}, t("Messages")), h("span", { class: "sp" }), h("span", { class: "xs muted" }, `${list.length}`)), listBox),
      h("div", { class: "card" }, h("div", { class: "hd" }, ic("flow"), h("h2", {}, t("What the AI did"))), h("div", { class: "bd" }, detailBox))));
}
