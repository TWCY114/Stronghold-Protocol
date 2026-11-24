// public/js/auth/fingerprint.js — a lightweight, dependency-free browser device fingerprint (account-plus). Hashes a set of
// stable device/browser attributes (canvas + WebGL renderer + screen + timezone + hardware) into a short hex id used to
// guide a second registration on the same device toward the existing account. It is a deterrent, not a security boundary
// (a determined user can spoof it); no external service or library is contacted. Returns '' when nothing can be computed.

function fallbackHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Compute a stable device fingerprint hex string (best-effort; '' on failure). */
export async function deviceFp() {
  try {
    const parts = [
      navigator.userAgent, navigator.language, (navigator.languages || []).join(','),
      `${screen.width}x${screen.height}x${screen.colorDepth}`, `${screen.availWidth}x${screen.availHeight}`,
      Intl.DateTimeFormat().resolvedOptions().timeZone, String(new Date().getTimezoneOffset()),
      String(navigator.hardwareConcurrency || ''), String(navigator.deviceMemory || ''), navigator.platform || '',
      String(navigator.maxTouchPoints || 0),
    ];
    try {
      const c = document.createElement('canvas'); c.width = 220; c.height = 60;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top'; ctx.font = '14px Arial'; ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, 120, 24);
        ctx.fillStyle = '#069'; ctx.fillText('SP-fingerprint-盟约', 2, 15);
        ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('SP-fingerprint-盟约', 4, 17);
        parts.push(c.toDataURL());
      }
    } catch { /* canvas blocked */ }
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      if (gl) { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); if (dbg) parts.push(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL), gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)); }
    } catch { /* webgl blocked */ }
    const raw = parts.join('||');
    if (crypto?.subtle?.digest) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }
    return fallbackHash(raw) + fallbackHash(raw.split('').reverse().join(''));
  } catch { return ''; }
}
