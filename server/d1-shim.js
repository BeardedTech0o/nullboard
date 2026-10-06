// A D1-shaped wrapper over node:sqlite, so the Worker's database code runs
// unchanged on a plain Node host. Covers exactly what worker/ uses:
// prepare().bind().run() / first() / all(), and batch() (one transaction).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  _run() {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.args);
    return { success: true, results: [], meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async run() { return this._run(); }
  async first() {
    const row = this.db.prepare(this.sql).get(...this.args);
    return row ? { ...row } : null;
  }
  async all() {
    const rows = this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r }));
    return { success: true, results: rows, meta: {} };
  }
}

export function d1(db) {
  return {
    prepare: (sql) => new Statement(db, sql),
    async batch(stmts) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = stmts.map((s) => s._run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

// Applies each migrations/*.sql file once, in name order, and records it.
// Same guarantee as `wrangler d1 migrations apply`: applied files never re-run.
export function migrate(db, dir) {
  db.exec('CREATE TABLE IF NOT EXISTS nb_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM nb_migrations').all().map((r) => r.name));
  const applied = [];
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
      db.prepare('INSERT INTO nb_migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
      db.exec('COMMIT');
      applied.push(name);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${err.message}`);
    }
  }
  return applied;
}
