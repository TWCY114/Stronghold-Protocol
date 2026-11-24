// public/js/chat/rich.js — [rich-chat] colour + emoji codes for chat bodies (world / room / PM).
//   • "#RRGGBB"  sets the running text colour (hex, case-insensitive) until the next colour code.
//   • "§x"       Minecraft-style colour code (0-9 a-f); "§r" resets colour+style; "§l" bold, "§o" italic,
//                "§n" underline, "§m" strikethrough.
//   • ":name:"   emoji shortcode (":smile:" → 😄). Unknown shortcodes are left as literal text.
// Everything is emitted as text nodes / styled <span> via textContent, so user input can never inject HTML.

export const MC = {
  0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA',
  8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};

export const EMOJI = {
  smile: '😄', laughing: '😆', joy: '😂', wink: '😉', cool: '😎', think: '🤔', cry: '😢', sob: '😭', angry: '😠',
  heart: '❤️', broken_heart: '💔', thumbsup: '👍', thumbsdown: '👎', ok: '👌', clap: '👏', wave: '👋', pray: '🙏',
  muscle: '💪', eyes: '👀', fire: '🔥', star: '⭐', sparkles: '✨', tada: '🎉', gift: '🎁', cake: '🎂', beer: '🍺',
  coffee: '☕', sun: '☀️', moon: '🌙', rain: '🌧️', snow: '❄️', lightning: '⚡', check: '✅', x: '❌', warning: '⚠️',
  question: '❓', exclamation: '❗', zzz: '💤', skull: '💀', ghost: '👻', alien: '👽', robot: '🤖', cat: '🐱',
  dog: '🐶', rose: '🌹', leaf: '🍃', money: '💰', gem: '💎', trophy: '🏆', medal: '🏅', sword: '⚔️', shield: '🛡️',
  bomb: '💣', rocket: '🚀', car: '🚗', plane: '✈️', ship: '🚢', house: '🏠', key: '🔑', lock: '🔒', unlock: '🔓',
  bell: '🔔', loud: '📢', chat: '💬', hundred: '💯', plus: '➕', minus: '➖', heart_eyes: '😍', kiss: '😘',
  hug: '🤗', salute: '🫡', party: '🥳', sweat: '😅', sleep: '😴', dizzy: '😵', mask: '😷', devil: '😈',
};

const TOKEN = /(#[0-9a-fA-F]{6})|§([0-9a-fA-FrRlLoOnNmM])|:([a-z0-9_+-]+):/g;

/** Parse a chat body into an array of safe DOM nodes (text + coloured/styled spans + emoji). */
export function richNodes(text) {
  const out = [];
  let color = null, bold = false, italic = false, underline = false, strike = false;
  const push = (s) => {
    if (!s) return;
    if (!color && !bold && !italic && !underline && !strike) { out.push(document.createTextNode(s)); return; }
    const sp = document.createElement('span');
    sp.textContent = s;
    if (color) sp.style.color = color;
    if (bold) sp.style.fontWeight = '700';
    if (italic) sp.style.fontStyle = 'italic';
    const deco = [];
    if (underline) deco.push('underline');
    if (strike) deco.push('line-through');
    if (deco.length) sp.style.textDecoration = deco.join(' ');
    out.push(sp);
  };
  let last = 0;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(String(text ?? '')))) {
    push(String(text).slice(last, m.index));
    last = TOKEN.lastIndex;
    if (m[1]) color = m[1];
    else if (m[2]) {
      const c = m[2].toLowerCase();
      if (c === 'r') { color = null; bold = italic = underline = strike = false; }
      else if (c === 'l') bold = true;
      else if (c === 'o') italic = true;
      else if (c === 'n') underline = true;
      else if (c === 'm') strike = true;
      else color = MC[c] || color;
    } else if (m[3]) {
      const e = EMOJI[m[3].toLowerCase()];
      if (e) push(e); else push(m[0]);
    }
  }
  push(String(text ?? '').slice(last));
  return out;
}
