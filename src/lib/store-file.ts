/**
 * Simple JSON-file store implementing RecoveryStore.
 *
 * Good enough for local dev, a demo, and low volume. For production swap in a
 * Postgres/Prisma adapter that implements the same RecoveryStore interface —
 * the engine doesn't care which is used.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { RecoveryStore } from "../core/store.js";
import type { Alert, CompanyConfig, RecoveryCase } from "../core/types.js";

interface Db {
  cases: Record<string, RecoveryCase>;
  configs: Record<string, CompanyConfig>;
  alerts: Record<string, Alert>;
}

const FILE = path.join(process.cwd(), "data", "recover-db.json");

async function read(): Promise<Db> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Db>;
    return {
      cases: parsed.cases ?? {},
      configs: parsed.configs ?? {},
      alerts: parsed.alerts ?? {},
    };
  } catch {
    return { cases: {}, configs: {}, alerts: {} };
  }
}

async function write(db: Db): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(db, null, 2), "utf8");
}

export class FileStore implements RecoveryStore {
  async getCase(id: string): Promise<RecoveryCase | null> {
    const db = await read();
    return db.cases[id] ?? null;
  }
  async saveCase(c: RecoveryCase): Promise<void> {
    const db = await read();
    db.cases[c.id] = c;
    await write(db);
  }
  async listDueCases(nowIso: string): Promise<RecoveryCase[]> {
    const db = await read();
    const now = Date.parse(nowIso);
    return Object.values(db.cases).filter(
      (c) =>
        c.status === "active" &&
        c.nextActionAt !== null &&
        Date.parse(c.nextActionAt) <= now,
    );
  }
  async listCasesByCompany(companyId: string): Promise<RecoveryCase[]> {
    const db = await read();
    return Object.values(db.cases).filter((c) => c.companyId === companyId);
  }
  async getConfig(companyId: string): Promise<CompanyConfig | null> {
    const db = await read();
    return db.configs[companyId] ?? null;
  }
  async saveConfig(c: CompanyConfig): Promise<void> {
    const db = await read();
    db.configs[c.companyId] = c;
    await write(db);
  }
  async saveAlert(a: Alert): Promise<void> {
    const db = await read();
    db.alerts[a.id] = a;
    await write(db);
  }
  async getAlert(id: string): Promise<Alert | null> {
    const db = await read();
    return db.alerts[id] ?? null;
  }
  async listAlertsByCompany(companyId: string): Promise<Alert[]> {
    const db = await read();
    return Object.values(db.alerts).filter((a) => a.companyId === companyId);
  }
}
