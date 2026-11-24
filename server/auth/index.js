// server/auth/index.js — lazy singleton of the login fork's auth. The database lives beside this module
// (server/auth/auth.db, WAL); the whole directory is new, so an official update zip leaves it alone. SP_AUTH=off
// disables the gate (development / official-test convenience); the default is on.

import { join } from 'node:path';
import { ROOT, makeLogger } from '../http/config.js';
import { createAuth } from './auth.js';

let auth = null;

/** The login gate is on unless SP_AUTH=off. */
export function authEnabled() { return process.env.SP_AUTH !== 'off'; }

/** The one auth instance (created on first use). SP_AUTH_DB overrides the database path (test / isolation). */
export function getAuth() {
  if (!auth) {
    const log = makeLogger(process.env.SP_QUIET === '1');
    const dbPath = process.env.SP_AUTH_DB || join(ROOT, 'server', 'auth', 'auth.db');
    auth = createAuth({ dbPath, log });
  }
  return auth;
}
