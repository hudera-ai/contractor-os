// Shared Arabic/English text helpers: normalisation, keyword matching, dates, durations, amounts.
// Deterministic and explainable: every decision can be shown in the trace.

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩", FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export function normalize(s) {
  return String(s || "")
    .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, d => String(FA_DIGITS.indexOf(d)))
    .replace(/[ً-ْـ]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[،؛؟]/g, m => ({ "،": ",", "؛": ";", "؟": "?" })[m])
    .toLowerCase().replace(/\s+/g, " ").trim();
}
export const detectLang = s => ((String(s).match(/[؀-ۿ]/g) || []).length >= (String(s).match(/[a-z]/gi) || []).length ? "ar" : "en");
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = w => new RegExp(`(^|[^\\p{L}])(?:[وفبل]|ال|وال|بال|لل)?${esc(normalize(w))}(?=$|[^\\p{L}])`, "iu");
export const has = (t, words) => words.some(w => word(w).test(t));
export const count = (t, words) => words.filter(w => word(w).test(t)).length;

// ---------------------------------------------------------------- numbers
const NUM_WORDS = { "واحد": 1, "وحده": 1, "يوم": 1, "يومين": 2, "اتنين": 2, "اثنين": 2, "ثنين": 2, "تلاته": 3, "ثلاثه": 3, "ثلاث": 3, "تلت": 3, "اربعه": 4, "اربع": 4, "خمسه": 5, "خمس": 5, "سته": 6, "ست": 6, "سبعه": 7, "سبع": 7, "تمانيه": 8, "ثمانيه": 8, "تسعه": 9, "عشره": 10, "عشر": 10, "اسبوع": 7, "اسبوعين": 14,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, week: 7, "a week": 7, "two weeks": 14 };

// ---------------------------------------------------------------- dates
const MONTHS = [["jan", "january", "يناير", "كانون الثاني"], ["feb", "february", "فبراير", "شباط"], ["mar", "march", "مارس", "اذار"], ["apr", "april", "ابريل", "نيسان"], ["may", "مايو", "ايار"], ["jun", "june", "يونيو", "حزيران"], ["jul", "july", "يوليو", "تموز"], ["aug", "august", "اغسطس", "اب"], ["sep", "sept", "september", "سبتمبر", "ايلول"], ["oct", "october", "اكتوبر", "تشرين الاول"], ["nov", "november", "نوفمبر", "تشرين الثاني"], ["dec", "december", "ديسمبر", "كانون الاول"]];
const DAYS = [["sun", "sunday", "الاحد", "احد"], ["mon", "monday", "الاثنين", "الاتنين", "اثنين", "اتنين"], ["tue", "tuesday", "الثلاثاء", "التلات", "ثلاثاء", "التلاتاء"], ["wed", "wednesday", "الاربعاء", "الاربع", "اربعاء"], ["thu", "thursday", "الخميس", "خميس"], ["fri", "friday", "الجمعه", "جمعه"], ["sat", "saturday", "السبت", "سبت"]];
const pad = n => String(n).padStart(2, "0");
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const atMidnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

function monthIndex(tok) { const t = normalize(tok); return MONTHS.findIndex(m => m.some(a => normalize(a) === t)); }

// Find every date mention with its position. Returns [{date, idx, len}]
export function findDates(text, today = new Date()) {
  const t = normalize(text); const base = atMidnight(today); const out = [];
  const push = (d, m) => { if (d && !isNaN(d)) out.push({ date: atMidnight(d), idx: m.index, len: m[0].length }); };
  let m;
  const reIso = /(\d{4})-(\d{1,2})-(\d{1,2})/g; while ((m = reIso.exec(t))) push(new Date(+m[1], +m[2] - 1, +m[3]), m);
  const reDmy = /(?<![\d-])(\d{1,2})[\/.](\d{1,2})(?:[\/.](\d{2,4}))?(?![\d-])/g;
  while ((m = reDmy.exec(t))) { let y = m[3] ? +m[3] : base.getFullYear(); if (y < 100) y += 2000; const d = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && d < addDays(base, -60)) d.setFullYear(y + 1); push(d, m); }
  const monthAlt = MONTHS.flat().map(normalize).sort((a, b) => b.length - a.length).map(esc).join("|");
  const reDM = new RegExp(`(\\d{1,2})\\s*(?:من\\s*)?(?:شهر\\s*)?(${monthAlt})(?:\\s*(\\d{4}))?`, "giu");
  while ((m = reDM.exec(t))) { const mi = monthIndex(m[2]); if (mi < 0) continue; let y = m[3] ? +m[3] : base.getFullYear(); const d = new Date(y, mi, +m[1]); if (!m[3] && d < addDays(base, -60)) d.setFullYear(y + 1); push(d, m); }
  const reMD = new RegExp(`(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`, "giu");
  while ((m = reMD.exec(t))) { if (out.some(o => Math.abs(o.idx - m.index) < 4)) continue; const mi = monthIndex(m[1]); if (mi < 0) continue; let y = m[3] ? +m[3] : base.getFullYear(); const d = new Date(y, mi, +m[2]); if (!m[3] && d < addDays(base, -60)) d.setFullYear(y + 1); push(d, m); }
  const rel = [[/بعد بكر[هة]|بعد غد|day after tomorrow/g, 2], [/(?<!بعد )(بكر[هة]|غدا|غدوه|tomorrow)/g, 1], [/النهارد[هة]|اليوم|today/g, 0]];
  for (const [re, n] of rel) { re.lastIndex = 0; while ((m = re.exec(t))) push(addDays(base, n), m); }
  const dayAlt = DAYS.flat().map(normalize).sort((a, b) => b.length - a.length).map(esc).join("|");
  const reDay = new RegExp(`(?:(next|this|coming)\\s+)?(?:يوم\\s+)?(${dayAlt})(?:\\s+(الجاي|القادم|الياي|اللي جاي|الجاية|next))?`, "giu");
  while ((m = reDay.exec(t))) {
    if (/^(احد|اثنين|اتنين)$/.test(m[2]) && !m[1] && !m[3]) continue; // "احد" / "اثنين" alone are usually numbers/words
    const wd = DAYS.findIndex(d => d.some(a => normalize(a) === m[2])); if (wd < 0) continue;
    let diff = (wd - base.getDay() + 7) % 7; if (diff === 0) diff = 7; if ((m[1] === "next" || m[3]) && diff < 3 && false) diff += 7;
    push(addDays(base, diff), m);
  }
  out.sort((a, b) => a.idx - b.idx);
  return out.filter((o, i) => !out.some((p, j) => j !== i && p.idx <= o.idx && p.idx + p.len >= o.idx + o.len && p.len > o.len));
}

// working days between two dates inclusive, excluding the weekend days (default Fri/Sat)
export function workingDays(from, to, weekend = [5, 6]) { let n = 0; for (let d = atMidnight(from); d <= to; d = addDays(d, 1)) if (!weekend.includes(d.getDay())) n++; return n; }
function addWorkingDays(from, n, weekend = [5, 6]) { let d = atMidnight(from); while (weekend.includes(d.getDay())) d = addDays(d, 1); let left = n - 1; while (left > 0) { d = addDays(d, 1); if (!weekend.includes(d.getDay())) left--; } return d; }

export function extractDuration(text) {
  const t = normalize(text);
  let m = /(\d+(?:\.\d+)?)\s*(?:ايام|يوم|days?|working days|ايام عمل)/u.exec(t); if (m) return +m[1];
  m = /(\d+)\s*(?:اسابيع|اسبوع|weeks?)/u.exec(t); if (m) return +m[1] * 5;
  for (const [w, n] of Object.entries(NUM_WORDS)) if (new RegExp(`(^|\\s)${esc(normalize(w))}(\\s+(ايام|يوم|days?))?($|\\s|[,.])`, "u").test(t) && /(يوم|ايام|يومين|اسبوع|days?|week)/u.test(t)) return n === 7 ? 5 : n === 14 ? 10 : n;
  if (/نص يوم|half day|half a day/u.test(t)) return 0.5;
  return null;
}

// Relative due dates for promises: "بعد شهرين", "خلال اسبوعين", "in 3 weeks", "after 20 days", "end of the month"
export function relativeDate(text, today = new Date()) {
  const t = normalize(text); const base = new Date(today); base.setHours(0, 0, 0, 0);
  const add = (n, unit) => { const d = new Date(base); if (unit === "m") d.setMonth(d.getMonth() + n); else d.setDate(d.getDate() + n * (unit === "w" ? 7 : 1)); return iso(d); };
  if (/نهايه الشهر|اخر الشهر|end of (the )?month|month end/u.test(t)) { const d = new Date(base.getFullYear(), base.getMonth() + 1, 0); return iso(d); }
  const words = { "شهرين": [2, "m"], "شهر": [1, "m"], "اسبوعين": [2, "w"], "اسبوع": [1, "w"], "يومين": [2, "d"], "تلات شهور": [3, "m"], "ثلاث شهور": [3, "m"], "ثلاثه اشهر": [3, "m"], "a month": [1, "m"], "a week": [1, "w"], "two weeks": [2, "w"], "two months": [2, "m"], "three months": [3, "m"] };
  if (/(بعد|خلال|في خلال|in|after|within)\s/u.test(t)) {
    let m = /(\d+)\s*(شهور|اشهر|شهر|months?|اسابيع|اسبوع|weeks?|ايام|يوم|days?)/u.exec(t);
    if (m) return add(+m[1], /شه|month/u.test(m[2]) ? "m" : /سبو|week/u.test(m[2]) ? "w" : "d");
    for (const [w, [n, u]] of Object.entries(words)) if (new RegExp(`(^|\\s)${esc(w)}($|\\s|[,.؟?])`, "u").test(t)) return add(n, u);
  }
  if (/الشهر الجاي|الشهر القادم|next month/u.test(t)) return add(1, "m");
  return null;
}

// "from X to Y" | "X to Y" | single date + duration
export function extractDateRange(text, today = new Date(), weekend = [5, 6]) {
  const ds = findDates(text, today); const dur = extractDuration(text);
  if (ds.length >= 2) { let [a, b] = [ds[0].date, ds[1].date]; if (b < a) [a, b] = [b, a]; return { from: iso(a), to: iso(b), days: workingDays(a, b, weekend), duration_stated: dur }; }
  if (ds.length === 1) { const a = ds[0].date; if (dur && dur >= 1) { const b = addWorkingDays(a, Math.ceil(dur), weekend); return { from: iso(a), to: iso(b), days: dur }; } return { from: iso(a), to: iso(a), days: dur === 0.5 ? 0.5 : 1, single: true }; }
  if (dur) return { from: null, to: null, days: dur };
  return null;
}

// ---------------------------------------------------------------- entities
export function amount(text) { const m = /(\d[\d,]*(?:\.\d+)?)\s*(?:ريال|ر\.?س|sar|sr|riyal)/iu.exec(normalize(text)) || /(?:sar|ريال)\s*(\d[\d,]*(?:\.\d+)?)/iu.exec(normalize(text)); return m ? +m[1].replace(/,/g, "") : null; }
export function pickNumberChoice(text, max) { const m = /^\s*(\d)\s*$/.exec(normalize(text)) || /(?:رقم|option|الخيار)\s*(\d)/u.exec(normalize(text)); if (m && +m[1] >= 1 && +m[1] <= max) return +m[1]; const ord = [["الاول", "first", "اول"], ["الثاني", "التاني", "second", "تاني"], ["الثالث", "التالت", "third", "تالت"]]; const t = normalize(text); const i = ord.findIndex(o => has(t, o)); return i >= 0 && i < max ? i + 1 : null; }
export function yesNo(text) { const t = normalize(text); if (has(t, ["نعم", "ايوه", "ايوا", "اي", "تمام", "اوكي", "ok", "okay", "yes", "yep", "sure", "اكيد", "موافق", "يب", "ماشي", "confirm", "اكد", "ابشر"])) return true; if (has(t, ["لا", "لاء", "no", "nope", "مش", "الغي", "الغاء", "cancel", "بلاش"])) return false; return null; }


// quantities with units: "120 م2", "35 m3", "200 متر", "4 طن", "3 rolls", "50 كيس"
export const UNITS = {
  m2: ["m2", "م2", "متر مربع", "sqm", "sq m", "مترمربع"], m3: ["m3", "م3", "متر مكعب", "cum", "cu m", "مكعب"], m: ["m", "lm", "متر طولي", "متر", "مط", "meter", "meters", "metre", "metres"],
  ton: ["ton", "tons", "طن", "t"], kg: ["kg", "كجم", "كيلو"], no: ["no", "nos", "pcs", "pc", "pieces", "عدد", "حبه", "حبة", "قطعه", "قطعة", "وحده", "وحدة", "units", "unit", "each"],
  roll: ["roll", "rolls", "لفه", "لفة", "رول"], bag: ["bag", "bags", "كيس", "شكاره", "شكارة"], set: ["set", "sets", "طقم"], ls: ["ls", "lump sum", "مقطوعيه", "مقطوعية", "lot"], day: ["day", "days", "يوم", "ايام"], length: ["length", "lengths", "ماسوره", "ماسورة", "بايب"],
};
const UNIT_RE = Object.entries(UNITS).flatMap(([k, ws]) => ws.map(w => [k, normalize(w)])).sort((a, b) => b[1].length - a[1].length);
export function unitOf(s) { const t = normalize(s); for (const [k, w] of UNIT_RE) if (t === w) return k; return null; }
export function quantities(text) {
  const t = normalize(text); const out = [];
  const re = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT_RE.map(([, w]) => esc(w)).join("|")})(?=$|[^\\p{L}\\d])`, "giu");
  let m; while ((m = re.exec(t))) out.push({ qty: +m[1].replace(/,/g, ""), unit: unitOf(m[2]), at: m.index, raw: m[0] });
  return out;
}
export { esc };
