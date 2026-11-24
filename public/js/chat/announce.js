// public/js/chat/announce.js — [announce] 全服紧急公告: a single marquee line that drifts across the TOP of the screen on
// whatever page the player is on. pointer-events:none + a high z-index means it never blocks clicks or covers controls.
// The admin chooses text / size / colour / speed; the line makes one pass and removes itself.

let host = null, active = 0;
function ensureHost() {
  if (!host) {
    host = document.createElement('div');
    host.id = 'sp-announce-host';
    host.style.cssText = 'position:fixed;left:0;top:0;width:100%;z-index:99999;pointer-events:none;overflow:hidden;';
    document.body.appendChild(host);
  }
  return host;
}

function show(m) {
  const h = ensureHost();
  const size = Math.min(64, Math.max(12, Number(m.size) || 22));
  const speed = Math.min(600, Math.max(40, Number(m.speed) || 160));
  const color = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(m.color || '')) ? m.color : '#ff5555';
  const line = document.createElement('div');
  line.textContent = String(m.text || '');
  line.style.cssText = `position:absolute;top:${8 + active * (size + 6)}px;left:0;white-space:nowrap;font-size:${size}px;line-height:1.2;color:${color};font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.85),0 0 2px rgba(0,0,0,.6);will-change:transform;`;
  h.appendChild(line);
  active++;
  const w = line.offsetWidth, dist = window.innerWidth + w, dur = dist / speed;
  line.style.transform = `translateX(${window.innerWidth}px)`;
  requestAnimationFrame(() => {
    line.style.transition = `transform ${dur}s linear`;
    line.style.transform = `translateX(${-w}px)`;
  });
  let gone = false;
  const done = () => { if (gone) return; gone = true; line.remove(); active = Math.max(0, active - 1); };
  line.addEventListener('transitionend', done, { once: true });
  setTimeout(done, dur * 1000 + 600);
}

export function installAnnounce({ net }) { net.on('announce', show); }
