// public/js/chat/pref.js — the chat on/off preference, toggled from 设置 → 界面插件 (the plugin manager). Stored in this
// browser only (sp.pref.chat-enabled), default ON. The chat panel listens for 'sp-chat-toggle' to show/hide live.
import { loadPref, savePref } from '../store.js';

const KEY = 'chat-enabled';
export function chatEnabled() { return loadPref(KEY, true) !== false; }
export function setChatEnabled(on) {
  savePref(KEY, !!on);
  window.dispatchEvent(new CustomEvent('sp-chat-toggle', { detail: !!on }));
}
