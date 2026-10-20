-- HUDERA Contractor OS · AI operating system for specialty contractors (multi-tenant SaaS)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
  trade TEXT NOT NULL, city TEXT, cr_no TEXT, vat_no TEXT, plan TEXT NOT NULL DEFAULT 'growth', settings TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','pm','procurement','estimator','site_engineer','viewer')),
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);

-- ---------- projects & execution
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, aliases TEXT,            -- comma-separated names people use on site
  client TEXT, consultant TEXT, city TEXT, scope TEXT,
  contract_value REAL NOT NULL, budget REAL NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','handover','closed')),
  pm_user_id INTEGER REFERENCES users(id), engineer_user_id INTEGER REFERENCES users(id),
  UNIQUE (tenant_id, code)
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, keywords TEXT NOT NULL,
  unit TEXT NOT NULL, qty REAL NOT NULL, budget_cost REAL NOT NULL, planned_start TEXT NOT NULL, planned_end TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS progress_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  date TEXT NOT NULL, qty REAL NOT NULL, note TEXT, message_id INTEGER
);
CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('material','labor','subcontract','equipment','overhead')),
  amount REAL NOT NULL, ref TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS invoices (                                       -- progress invoices to the client
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  no TEXT NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL, due_date TEXT NOT NULL, paid_date TEXT, status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','paid'))
);
CREATE TABLE IF NOT EXISTS manpower (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date TEXT NOT NULL, trade TEXT NOT NULL, count INTEGER NOT NULL, message_id INTEGER
);

-- ---------- field messages (WhatsApp from site) and what the AI made of them
CREATE TABLE IF NOT EXISTS field_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id), sender_user_id INTEGER REFERENCES users(id), sender_name TEXT NOT NULL, sender_phone TEXT,
  body TEXT NOT NULL, at TEXT NOT NULL, kind TEXT, confidence REAL, parsed TEXT, trace TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','applied','needs_review','ignored')),
  routed_to TEXT, reply TEXT
);
CREATE TABLE IF NOT EXISTS rfis (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  no TEXT NOT NULL, subject TEXT NOT NULL, question TEXT NOT NULL, location TEXT, discipline TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','answered','closed')),
  raised_at TEXT NOT NULL, due_at TEXT NOT NULL, answered_at TEXT, answer TEXT, message_id INTEGER
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('safety','delay','quality')), description TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium',
  cause TEXT, delay_days REAL, at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')), message_id INTEGER
);

-- ---------- procurement
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL, categories TEXT NOT NULL, city TEXT, rating REAL NOT NULL DEFAULT 4, payment_terms TEXT, phone TEXT, email TEXT,
  price_factor REAL NOT NULL DEFAULT 1, lead_days INTEGER NOT NULL DEFAULT 7, on_time_rate REAL NOT NULL DEFAULT 0.9
);
CREATE TABLE IF NOT EXISTS catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL, ref_price REAL NOT NULL, keywords TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS material_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id), no TEXT NOT NULL, requested_by TEXT NOT NULL, needed_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','rfq_sent','quoted','pending_approval','approved','po_issued','delivered','cancelled')),
  created_at TEXT NOT NULL, message_id INTEGER, note TEXT
);
CREATE TABLE IF NOT EXISTS mr_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mr_id INTEGER NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  catalog_id INTEGER REFERENCES catalog(id), description TEXT NOT NULL, qty REAL NOT NULL, unit TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mr_id INTEGER NOT NULL REFERENCES material_requests(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id), lines TEXT NOT NULL, subtotal REAL NOT NULL, vat REAL NOT NULL, total REAL NOT NULL,
  lead_days INTEGER NOT NULL, valid_until TEXT NOT NULL, missing_items INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL,
  score REAL, recommended INTEGER NOT NULL DEFAULT 0, reasons TEXT
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mr_id INTEGER NOT NULL REFERENCES material_requests(id), quote_id INTEGER NOT NULL REFERENCES quotes(id), supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  no TEXT NOT NULL, total REAL NOT NULL, issued_at TEXT NOT NULL, expected_at TEXT NOT NULL, delivered_at TEXT,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','delivered','cancelled'))
);

-- ---------- estimation
CREATE TABLE IF NOT EXISTS cost_db (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL, trade TEXT NOT NULL, description TEXT NOT NULL, description_ar TEXT NOT NULL, unit TEXT NOT NULL,
  material REAL NOT NULL, labor REAL NOT NULL, equipment REAL NOT NULL DEFAULT 0, keywords TEXT NOT NULL, productivity TEXT
);
CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  no TEXT NOT NULL, client TEXT NOT NULL, title TEXT NOT NULL, tender_text TEXT NOT NULL, lines TEXT NOT NULL,
  overhead_pct REAL NOT NULL, risk_pct REAL NOT NULL, margin_pct REAL NOT NULL, totals TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','won','lost')), created_at TEXT NOT NULL, created_by INTEGER
);

-- ---------- control
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, ref_id INTEGER NOT NULL, title TEXT NOT NULL, amount REAL, reason TEXT, approver_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')), created_at TEXT NOT NULL, decided_by INTEGER, decided_at TEXT, comment TEXT
);
CREATE TABLE IF NOT EXISTS ai_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id INTEGER, question TEXT NOT NULL, intent TEXT, answer TEXT, at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, at TEXT NOT NULL, user_id INTEGER, actor TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_prog ON progress_entries(activity_id, date);
CREATE INDEX IF NOT EXISTS idx_costs ON costs(project_id, date);
CREATE INDEX IF NOT EXISTS idx_fm ON field_messages(tenant_id, at);
