// server/admin/matchEdit.js — [auth-fork] admin live-match editing: read a running match's state, set an in-match
// player's funds (金钱), or jump the room's round (回合). New fork module. installMatchAdmin(Match) puts ONE method
// `adminEdit(playerId, cmd, args)` on Match.prototype; Match.js calls it (a [auth-fork] hook), so every Match has it —
// both an in-process vanilla match AND a gameplay-plugin match inside a match-host child (the child imports Match.js too).
// The proxy (server/match/host/proxy.js, [auth-fork] hook) forwards adminEdit over IPC, so the wrappers below work the
// same for room.match whether it is a real Match or a MatchProxy.
//
// adminEdit reuses the match's OWN test primitives (_testFunds / _testRound from match/testCommands.js): they already
// guard the phase (no live battle / terminal phase), eliminate LP<=0 players before a round jump, run the real
// startRound flow (waves, income, shop, drafts) and mark state dirty so clients update. The test-only / host-only gate
// lives in applyTestCommand, NOT in these primitives, so an admin may target any seat. args are JSON-safe (playerId /
// amount / round) so the same call crosses the host IPC unchanged.

/** Find a PlayerState by id regardless of whether the caller passed a number or a string. */
function playerOf(match, playerId) {
  if (playerId == null) return null;
  return match.players.get(playerId) ?? match.players.get(Number(playerId)) ?? match.players.get(String(playerId)) ?? null;
}

/** Install Match.prototype.adminEdit (idempotent). Called by Match.js for every Match class. */
export function installMatchAdmin(Match) {
  if (typeof Match !== 'function' || Match.prototype.adminEdit) return;
  Match.prototype.adminEdit = function adminEdit(playerId, cmd, args = {}) {
    if (cmd === 'state') {
      const players = [...this.players.values()].map((ps) => ({
        playerId: ps.playerId, name: ps.name ?? null, seat: ps.seat, funds: ps.funds, lp: ps.lp,
        alive: !!ps.alive, spectator: !!ps.spectator, bandId: ps.bandId ?? null,
      }));
      return { ok: true, round: this.round, phase: this.phase, bossRound: this.gd?.bossRound ?? null, lastRound: this.gd?.lastRound ?? null, players };
    }
    if (cmd === 'funds') {
      const ps = playerOf(this, playerId);
      if (!ps) return { ok: false, error: 'no_player' };
      const v = Number(args.amount);
      if (!Number.isFinite(v) || v < 0 || v > 1e9) return { ok: false, error: 'bad_amount' };
      const r = this._testFunds(ps, Math.trunc(v));
      if (r && r.error) return { ok: false, error: r.error };
      return { ok: true, playerId: ps.playerId, funds: ps.funds };
    }
    if (cmd === 'round') {
      const r = Number(args.round);
      if (!Number.isInteger(r) || r < 1) return { ok: false, error: 'bad_round' };
      const ps = this.order.find((p) => p.alive && p.bandId) || this.order.find((p) => p.alive);
      if (!ps) return { ok: false, error: 'no_player' };
      const res = this._testRound(ps, r);
      if (res && res.error) return { ok: false, error: res.error, detail: res.detail ?? null };
      return { ok: true, round: this.round };
    }
    return { ok: false, error: 'bad_cmd' };
  };
}

/** A running match for the room (real Match or MatchProxy), or an error result. */
function liveMatch(room) {
  const m = room?.match;
  if (!m) return { err: { ok: false, error: 'no_match' } };
  if (typeof m.adminEdit !== 'function') return { err: { ok: false, error: 'unsupported_match' } };
  return { m };
}

/** Current round / phase and every seat's funds / LP / alive. Async: a hosted match answers over IPC. */
export async function matchState(room) {
  const { m, err } = liveMatch(room);
  if (err) return err;
  const r = await m.adminEdit(null, 'state', {});
  return { ...r, code: room.code };
}

/** Set one player's funds to an absolute non-negative amount. */
export async function editFunds(room, playerId, amount) {
  const { m, err } = liveMatch(room);
  if (err) return err;
  return await m.adminEdit(playerId, 'funds', { amount });
}

/** Jump the whole room to a round (1..lastRound/hidden); the match's own jump helper handles elimination + startRound. */
export async function editRound(room, round) {
  const { m, err } = liveMatch(room);
  if (err) return err;
  return await m.adminEdit(null, 'round', { round });
}
