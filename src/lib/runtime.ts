/**
 * Assembles the engine from environment config. Chooses a real Whop messenger
 * (and, on Pro, a real Whop evidence drafter) or mock ones based on
 * MESSENGER_MODE, and a persistent file store.
 */

import type { EvidenceDrafter } from "../core/evidence";
import { RecoveryEngine } from "../core/engine";
import { MockMessenger, WhopMessenger, type Messenger } from "../core/messaging";
import type { RecoveryStore } from "../core/store";
import { WhopEvidenceDrafter } from "./disputes";
import { FileStore } from "./store-file";
import { whopClient } from "./whop";

let _engine: RecoveryEngine | null = null;
let _store: RecoveryStore | null = null;

export function getStore(): RecoveryStore {
  if (!_store) _store = new FileStore();
  return _store;
}

function getMessenger(): Messenger {
  const mode = (process.env.MESSENGER_MODE ?? "mock").toLowerCase();
  if (mode === "whop") {
    return new WhopMessenger(whopClient() as any);
  }
  return new MockMessenger();
}

function getEvidenceDrafter(): EvidenceDrafter | undefined {
  const mode = (process.env.MESSENGER_MODE ?? "mock").toLowerCase();
  if (mode === "whop") {
    return new WhopEvidenceDrafter(whopClient() as any);
  }
  return undefined;
}

export function getEngine(): RecoveryEngine {
  if (_engine) return _engine;
  _engine = new RecoveryEngine({
    store: getStore(),
    messenger: getMessenger(),
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
    evidenceDrafter: getEvidenceDrafter(),
  });
  return _engine;
}
