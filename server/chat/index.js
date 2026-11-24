// server/chat/index.js — lazy singleton of the chat/friends backend (P3). wireChat() is called at boot with the session
// registry; it shares the account database so account ids align. getChat() is used by the WS dispatcher (chat/ws.js) and
// by the hello hook that delivers offline mail.

import { join } from 'node:path';
import { ROOT, makeLogger } from '../http/config.js';
import { createChat } from './chat.js';

let chat = null;

export function wireChat({ registry, log }) {
  if (!chat) {
    const dbPath = process.env.SP_AUTH_DB || join(ROOT, 'server', 'auth', 'auth.db');
    chat = createChat({ dbPath, registry, log: log || makeLogger(process.env.SP_QUIET === '1') });
  }
}

export function getChat() { return chat; }
