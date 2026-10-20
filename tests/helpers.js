import initSqlJs from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { wrap } from "../shared/dbx.js";
import { applySeed } from "../shared/seed.js";
import { call } from "../shared/service.js";
const here = path.dirname(fileURLToPath(import.meta.url));
let SQL;
export async function freshDb() { SQL ||= await initSqlJs(); const dbx = wrap(new SQL.Database()); dbx.exec(fs.readFileSync(path.join(here, "..", "db", "schema.sql"), "utf8")); applySeed(dbx); return dbx; }
export async function as(dbx, email) { return { user: (await call(dbx, {}, "auth.login", { email, password: "demo1234" })).user }; }
