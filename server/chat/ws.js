// server/chat/ws.js — dispatches the fork's chat / friend / PM WebSocket messages (P3). Hooked into server/net.js onFrame
// ahead of the game's C2S validation, so these fork-only types never touch shared/protocol.js. Replies are fork S2C types
// the client chat panel subscribes to (public/js/chat/). Every action requires a hello'd session; friends / PM additionally
// require a registered account (enforced in chat.js).

import { getChat } from './index.js';

/**
 * @param {{ session: object|null, ws: object }} conn
 * @param {{ t: string, [k: string]: any }} msg
 */
export function handleChat(conn, msg) {
  const reply = (m) => { try { conn.ws.send(JSON.stringify(m)); } catch { /* ignore */ } };
  const chat = getChat();
  if (!chat) { reply({ t: 'chat.error', error: 'not_ready' }); return; }
  const session = conn.session;
  if (!session) { reply({ t: 'chat.error', error: 'hello_required' }); return; }

  switch (msg.t) {
    case 'chat.send': {
      const r = chat.sendChat(session, msg.body, msg.channel === 'room' ? 'room' : 'world');
      if (!r.ok) reply({ t: 'chat.error', error: r.error, scope: 'lobby' });
      break;
    }
    case 'chat.history':
      reply({ t: 'chat.history', channel: msg.channel === 'room' ? 'room' : 'world', messages: chat.history(session, msg.channel === 'room' ? 'room' : 'world', Number(msg.limit) || 50) });
      break;
    case 'friend.request':
      reply({ t: 'friend.result', action: 'request', ...chat.requestFriend(session, msg.toId) });
      break;
    case 'friend.respond':
      reply({ t: 'friend.result', action: 'respond', ...chat.respondFriend(session, msg.fromId, msg.accept === true) });
      break;
    case 'friend.remove':
      reply({ t: 'friend.result', action: 'remove', ...chat.removeFriend(session, msg.otherId) });
      break;
    case 'friend.list':
      reply({ t: 'friend.list', friends: chat.friendsList(session), requests: chat.pendingRequests(session) });
      break;
    case 'friend.invite': // [friend-invite]
      reply({ t: 'friend.result', action: 'invite', ...chat.inviteFriend(session, msg.toId) });
      break;
    case 'friend.invite.respond': // [friend-invite]
      reply({ t: 'friend.result', action: 'inviteRespond', ...chat.inviteRespond(session, msg.fromId, msg.accept === true) });
      break;
    case 'pm.send': {
      const r = chat.sendPM(session, msg.toId, msg.body);
      if (!r.ok) reply({ t: 'chat.error', error: r.error, scope: 'pm' });
      break;
    }
    case 'pm.history':
      reply({ t: 'pm.history', otherId: Number(msg.otherId), messages: chat.pmHistory(session, msg.otherId, Number(msg.limit) || 100) });
      break;
    default:
      reply({ t: 'chat.error', error: 'unknown_type' });
  }
}
