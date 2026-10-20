// Earned-value metrics per project, computed from activities, progress entries and costs.
// PV = budget × planned fraction today · EV = budget × executed fraction · AC = actual cost
// SPI = EV / PV (schedule) · CPI = EV / AC (cost) · EAC = BAC / CPI · forecast delay ≈ duration × (1/SPI − 1)
const day = s => new Date(String(s).slice(0, 10) + "T00:00:00");
export const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function plannedFraction(a, at) {
  const s = day(a.planned_start), e = day(a.planned_end), t = day(at);
  if (t <= s) return 0; if (t >= e) return 1; return (t - s) / (e - s);
}

export function projectStats(dbx, p, now = new Date()) {
  const today = isoDay(now);
  const acts = dbx.all(`SELECT a.*, COALESCE((SELECT SUM(qty) FROM progress_entries e WHERE e.activity_id=a.id),0) AS done FROM activities a WHERE a.project_id=? ORDER BY a.code`, [p.id]);
  const bac = acts.reduce((x, a) => x + a.budget_cost, 0) || p.budget;
  let pv = 0, ev = 0;
  for (const a of acts) { a.pct = a.qty ? Math.min(1, a.done / a.qty) : 0; a.planned_pct = plannedFraction(a, today); pv += a.budget_cost * a.planned_pct; ev += a.budget_cost * a.pct; a.behind = a.planned_pct - a.pct > 0.1; }
  const ac = dbx.get("SELECT COALESCE(SUM(amount),0) s FROM costs WHERE project_id=?", [p.id]).s;
  const spi = pv > 0 ? ev / pv : 1, cpi = ac > 0 ? ev / ac : 1;
  const durDays = Math.max(1, (day(p.end_date) - day(p.start_date)) / 864e5);
  const forecastDelay = spi < 1 && pv > 0 ? Math.round(durDays * (1 / Math.max(0.3, spi) - 1)) : 0;
  const q1 = (sql, args = [p.id]) => dbx.get(sql, args);
  const billed = q1("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE project_id=?").s;
  const collected = q1("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE project_id=? AND status='paid'").s;
  const overdueRecv = q1("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE project_id=? AND status='issued' AND due_date < ?", [p.id, today]).s;
  return {
    bac: Math.round(bac), pv: Math.round(pv), ev: Math.round(ev), ac: Math.round(ac),
    progress: +(100 * ev / bac).toFixed(1), planned: +(100 * pv / bac).toFixed(1), spi: +spi.toFixed(2), cpi: +cpi.toFixed(2),
    eac: Math.round(cpi > 0 ? bac / cpi : bac), forecast_delay_days: forecastDelay, margin_forecast: Math.round(p.contract_value - (cpi > 0 ? bac / cpi : bac)),
    open_rfis: q1("SELECT COUNT(*) n FROM rfis WHERE project_id=? AND status='open'").n,
    overdue_rfis: q1("SELECT COUNT(*) n FROM rfis WHERE project_id=? AND status='open' AND due_at < ?", [p.id, today]).n,
    open_delays: q1("SELECT COUNT(*) n FROM incidents WHERE project_id=? AND kind='delay' AND status='open'").n,
    open_safety: q1("SELECT COUNT(*) n FROM incidents WHERE project_id=? AND kind='safety' AND status='open' AND severity<>'low'").n,
    pending_mrs: q1("SELECT COUNT(*) n FROM material_requests WHERE project_id=? AND status IN ('new','rfq_sent','quoted','pending_approval','approved')").n,
    open_pos: q1("SELECT COUNT(*) n FROM purchase_orders po JOIN material_requests m ON m.id=po.mr_id WHERE m.project_id=? AND po.status='issued'").n,
    late_pos: q1("SELECT COUNT(*) n FROM purchase_orders po JOIN material_requests m ON m.id=po.mr_id WHERE m.project_id=? AND po.status='issued' AND po.expected_at < ?", [p.id, today]).n,
    billed: Math.round(billed), collected: Math.round(collected), overdue_receivables: Math.round(overdueRecv),
    manpower_today: q1("SELECT COALESCE(SUM(count),0) n FROM manpower WHERE project_id=? AND date=(SELECT MAX(date) FROM manpower WHERE project_id=?)", [p.id, p.id]).n,
    last_report: q1("SELECT MAX(at) d FROM field_messages WHERE project_id=?").d,
    activities: acts,
  };
}

export function health(s) {
  if (s.spi < 0.85 || s.cpi < 0.88 || s.overdue_rfis > 1) return "red";
  if (s.spi < 0.95 || s.cpi < 0.97 || s.overdue_rfis > 0 || s.late_pos > 0) return "amber";
  return "green";
}
