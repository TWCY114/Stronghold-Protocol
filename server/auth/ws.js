// server/auth/ws.js — the /ws upgrade gate (P1). Hooked into server/http/websocket.js after the path/admission checks:
// a socket must carry a valid account/guest token (?token=…) or the upgrade is refused before any session exists.
// SP_AUTH=off bypasses (development). The resolved principal rides on req.spAccount into net.js' hello.

import { getAuth, authEnabled } from './index.js';

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {{ query: URLSearchParams }} parts
 * @returns {{ok:true, principal:object|null}|{ok:false, code:'no-token'|'bad-token'}}
 */
export function gateUpgrade(req, parts) {
  if (!authEnabled()) return { ok: true, principal: null };
  const token = new URLSearchParams(parts?.query || '').get('token') || '';
  if (!token) return { ok: false, code: 'no-token' };
  const v = getAuth().verifyToken(token);
  if (!v.ok) return { ok: false, code: 'bad-token' };
  return { ok: true, principal: v };
}
