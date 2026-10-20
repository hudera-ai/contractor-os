// Procurement agent: material request → RFQ to the right suppliers → quotes → scored comparison with
// reasons → approval rule → purchase order. Supplier responses are simulated deterministically in the demo
// (price = catalogue reference × supplier price level × small variation); in production they arrive by e-mail/portal.

export const VAT = 0.15;
const seeded = (a, b) => { let s = (a * 2654435761 + b * 97) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const iso = d => d.toISOString().slice(0, 10);

export function pickSuppliers(suppliers, categories, max = 4) {
  const want = new Set(categories);
  return suppliers.map(s => ({ s, cover: s.categories.split(",").map(x => x.trim()).filter(c => want.has(c)).length }))
    .filter(x => x.cover > 0).sort((a, b) => b.cover - a.cover || b.s.rating - a.s.rating).slice(0, max).map(x => x.s);
}

export function simulateQuote(mr, items, supplier, catalogById, now = new Date()) {
  const r = seeded(mr.id, supplier.id); const cats = supplier.categories.split(",").map(x => x.trim());
  const lines = []; let missing = 0;
  for (const it of items) {
    const c = catalogById[it.catalog_id];
    if (!c || !cats.includes(c.category) || r() < 0.06) { missing++; lines.push({ item_id: it.id, description: it.description, qty: it.qty, unit: it.unit, rate: null, amount: 0, note: "not quoted" }); continue; }
    const rate = +(c.ref_price * supplier.price_factor * (0.94 + r() * 0.14)).toFixed(2);
    lines.push({ item_id: it.id, description: it.description, qty: it.qty, unit: it.unit, rate, amount: +(rate * it.qty).toFixed(2) });
  }
  const subtotal = +lines.reduce((a, l) => a + l.amount, 0).toFixed(2);
  const lead = Math.max(1, Math.round(supplier.lead_days * (0.8 + r() * 0.5)));
  return { supplier_id: supplier.id, lines, subtotal, vat: +(subtotal * VAT).toFixed(2), total: +(subtotal * (1 + VAT)).toFixed(2), lead_days: lead, valid_until: iso(new Date(now.getTime() + 14 * 864e5)), missing_items: missing };
}

// Score: price 55 · delivery vs needed-by 25 · reliability (rating × on-time) 20 · −15 per missing line.
export function compareQuotes(quotes, suppliersById, { needed_by, now = new Date(), lang = "en" }) {
  const L = (ar, en) => (lang === "ar" ? ar : en);
  const full = quotes.filter(q => q.subtotal > 0);
  if (!full.length) return [];
  // compare like with like: a missing line is priced at the highest rate anyone quoted for it (+20%)
  const worst = {}; for (const q of full) for (const l of q.lines) if (l.rate != null) worst[l.item_id] = Math.max(worst[l.item_id] || 0, l.rate);
  const norm = q => q.lines.reduce((a, l) => a + (l.rate != null ? l.amount : (worst[l.item_id] || 0) * 1.2 * l.qty), 0);
  const minNorm = Math.min(...full.map(norm));
  const window = Math.max(1, daysBetween(iso(now), needed_by));
  const scored = quotes.map(q => {
    const s = suppliersById[q.supplier_id]; const reasons = [];
    const n = norm(q); const unit = n; const minPrice = minNorm;
    const price = q.subtotal ? 55 * (minNorm / n) : 0;
    const late = q.lead_days - window;
    const delivery = late <= 0 ? 25 : Math.max(0, 25 - late * 5);
    const reliability = 20 * (s.rating / 5) * s.on_time_rate;
    const score = +(price + delivery + reliability - 15 * q.missing_items).toFixed(1);
    if (q.missing_items) reasons.push(L("السعر مقارن بعد تسعير البنود الناقصة بأعلى سعر معروض", "price compared after filling missing lines at the highest quoted rate"));
    if (Math.abs(unit - minPrice) < 0.01 && !q.missing_items) reasons.push(L("أقل سعر", "lowest price"));
    if (late > 0) reasons.push(L(`يتأخر ${late} يوم عن الموعد المطلوب`, `${late} day(s) later than needed`)); else reasons.push(L(`يوصل خلال ${q.lead_days} يوم (قبل الموعد)`, `delivers in ${q.lead_days} days (on time)`));
    if (q.missing_items) reasons.push(L(`لم يسعّر ${q.missing_items} بند`, `${q.missing_items} item(s) not quoted`));
    reasons.push(L(`تقييم ${s.rating}/5 · التزام بالمواعيد ${Math.round(s.on_time_rate * 100)}%`, `rating ${s.rating}/5 · on-time ${Math.round(s.on_time_rate * 100)}%`));
    return { ...q, score, reasons, parts: { price: +price.toFixed(1), delivery: +delivery.toFixed(1), reliability: +reliability.toFixed(1), missing: -15 * q.missing_items } };
  }).sort((a, b) => b.score - a.score);
  if (scored[0]) scored[0].recommended = 1;
  return scored;
}

export const PO_APPROVAL_LIMIT = 50000; // SAR incl. VAT — above this the owner approves the PO
