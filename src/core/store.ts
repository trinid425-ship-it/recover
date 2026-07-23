/**
 * Storage abstraction. The engine depends only on this interface, so the
 * in-memory implementation (used by the test harness) and a real database
 * implementation are interchangeable. Ship a Postgres/Prisma adapter for
 * production by implementing the same interface.
 */

import type { Alert, CompanyConfig, RecoveryCase } from "./types.js";

export interface RecoveryStore {
  getCase(id: string): Promise<RecoveryCase | null>;
  saveCase(c: RecoveryCase): Promise<void>;
  /** Active cases whose nextActionAt is due (<= now). */
  listDueCases(nowIso: string): Promise<RecoveryCase[]>;
  listCasesByCompany(companyId: string): Promise<RecoveryCase[]>;

  getConfig(companyId: string): Promise<CompanyConfig | null>;
  saveConfig(c: CompanyConfig): Promise<void>;

  saveAlert(a: Alert): Promise<void>;
  getAlert(id: string): Promise<Alert | null>;
  listAlertsByCompany(companyId: string): Promise<Alert[]>;
}

/** Deterministic case id so repeated failures for the same membership collapse. */
export function caseId(companyId: string, membershipId: string): string {
  return `rc_${companyId}_${membershipId}`;
}

export class InMemoryStore implements RecoveryStore {
  private cases = new Map<string, RecoveryCase>();
  private configs = new Map<string, CompanyConfig>();
  private alerts = new Map<string, Alert>();

  async getCase(id: string): Promise<RecoveryCase | null> {
    return this.cases.get(id) ?? null;
  }

  async saveCase(c: RecoveryCase): Promise<void> {
    // store a copy to avoid accidental external mutation
    this.cases.set(c.id, structuredClone(c));
  }

  async listDueCases(nowIso: string): Promise<RecoveryCase[]> {
    const now = Date.parse(nowIso);
    return [...this.cases.values()]
      .filter(
        (c) =>
          c.status === "active" &&
          c.nextActionAt !== null &&
          Date.parse(c.nextActionAt) <= now,
      )
      .map((c) => structuredClone(c));
  }

  async listCasesByCompany(companyId: string): Promise<RecoveryCase[]> {
    return [...this.cases.values()]
      .filter((c) => c.companyId === companyId)
      .map((c) => structuredClone(c));
  }

  async getConfig(companyId: string): Promise<CompanyConfig | null> {
    return this.configs.get(companyId) ?? null;
  }

  async saveConfig(c: CompanyConfig): Promise<void> {
    this.configs.set(c.companyId, structuredClone(c));
  }

  async saveAlert(a: Alert): Promise<void> {
    this.alerts.set(a.id, structuredClone(a));
  }

  async getAlert(id: string): Promise<Alert | null> {
    return this.alerts.get(id) ?? null;
  }

  async listAlertsByCompany(companyId: string): Promise<Alert[]> {
    return [...this.alerts.values()]
      .filter((a) => a.companyId === companyId)
      .map((a) => structuredClone(a));
  }
}
