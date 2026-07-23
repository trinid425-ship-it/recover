/**
 * Assembles the engine from environment config. Chooses a real Whop messenger
 * or a mock one based on MESSENGER_MODE, and a persistent file store.
 */

import { RecoveryEngine } from "../core/engine";
import { MockMessenger, WhopMessenger, type Messenger } from "../core/messaging";
import type { RecoveryStore } from "../core/store";
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

export function getEngine(): RecoveryEngine {
  if (_engine) return _engine;
  _engine = new RecoveryEngine({
    store: getStore(),
    messenger: getMessenger(),
    appBaseUrl: process.env.APP_BASE_URL ?? "http://localhost:3000",
  });
  return _engine;
}
