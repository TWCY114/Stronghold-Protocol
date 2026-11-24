// server/admin/index.js — the login fork's admin backend wiring (P2). wireAdmin() is called once at boot (server/index.js)
// with the live network / lobby / registry; it starts a fixed-interval sampler of the online counters into a ring buffer
// so the admin page can draw a real time-series line chart (not just a live number). getAdmin() exposes the deps + history
// to server/admin/http.js. New directory: an official update zip leaves it alone; only the wireAdmin hook needs rebase.

const SAMPLE_MS = 5000;        // one point every 5 s
const MAX_SAMPLES = 720;       // keep the last hour (720 × 5 s)

let deps = null;
let timer = null;
const history = [];

function sample() {
  if (!deps) return;
  const { network, lobby } = deps;
  let s;
  try { s = lobby.stats(); } catch { s = { rooms: 0, matches: 0, humans: 0, bots: 0, spectators: 0 }; }
  let online = 0;
  try { online = network.onlineCount; } catch { /* ignore */ }
  history.push({ t: Date.now(), online, ...s });
  if (history.length > MAX_SAMPLES) history.splice(0, history.length - MAX_SAMPLES);
}

/**
 * Wire the admin backend to the live session stack and start sampling.
 * @param {{ network: object, lobby: object, registry: object, log?: object }} d
 */
export function wireAdmin(d) {
  deps = d;
  if (!timer) {
    sample();
    timer = setInterval(sample, SAMPLE_MS);
    timer.unref?.();
  }
}

/** The admin deps + sampled history (null before boot wires it). */
export function getAdmin() {
  return deps ? { ...deps, history, sampleMs: SAMPLE_MS } : null;
}
