// test-match-edit.mjs — [auth-fork] admin live-match editing (matchState / editFunds / editRound) on a REAL in-process
// Match built by the engine harness. Run: node test-match-edit.mjs
import { makeMatch } from './test/match/harness.js';
import { matchState, editFunds, editRound } from './server/admin/matchEdit.js';

let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };

const h = makeMatch({ mode: 'solo', humans: 1, fake: true, test: true });
h.start();
h.toPrep();
const m = h.m;
const room = { code: 'TEST', match: m };
const ps = h.ps('p_0');

console.log('[matchState]');
const st = await matchState(room);
ok(st.ok && st.round === 1, 'matchState 返回当前回合', JSON.stringify({ ok: st.ok, round: st.round }));
ok(st.players.length === 1 && st.players[0].playerId === 'p_0', 'matchState 列出玩家', JSON.stringify(st.players));
ok(typeof st.players[0].funds === 'number' && typeof st.players[0].lp === 'number', '玩家含 funds/lp');
ok(st.phase === 'PREP', 'matchState 含相位', st.phase);
ok(typeof m.adminEdit === 'function', 'Match.prototype 已装 adminEdit');

console.log('[editFunds]');
const f1 = await editFunds(room, 'p_0', 500);
ok(f1.ok && f1.funds === 500 && ps.funds === 500, '设为 500 生效', JSON.stringify(f1));
const f2 = await editFunds(room, 'p_0', 300);
ok(f2.ok && ps.funds === 300, '绝对值覆盖为 300（非累加）', JSON.stringify(f2));
ok((await editFunds(room, 'p_0', -5)).error === 'bad_amount', '负数拒绝');
ok((await editFunds(room, 'p_0', 1.5)).ok, '小数取整接受');
ok((await editFunds(room, 'nobody', 100)).error === 'no_player', '不存在玩家拒绝');

console.log('[editRound]');
ok(!!ps.bandId, 'solo 已选策略（跳回合前提）', ps.bandId);
const r1 = await editRound(room, 5);
ok(r1.ok && m.round === 5, '跳到 R5 生效', JSON.stringify(r1));
const r2 = await editRound(room, 8);
ok(r2.ok && m.round === 8, '再跳 R8', JSON.stringify(r2));
ok((await editRound(room, 0)).error === 'bad_round', '回合 0 拒绝');
const rHi = await editRound(room, 999);
ok(!rHi.ok && rHi.error === 'BAD_TARGET', '超上限回合拒绝', JSON.stringify(rHi));

console.log('[错误分支 / hosted 代理]');
ok((await matchState({ code: 'X', match: null })).error === 'no_match', '无对局 no_match');
ok((await editFunds({ code: 'X', match: null }, 'p_0', 1)).error === 'no_match', '无对局 editFunds no_match');
ok((await matchState({ code: 'X', match: { hosted: true } })).error === 'unsupported_match', '无 adminEdit 的代理 unsupported_match');
// a hosted-style proxy whose adminEdit is async (IPC): the wrappers must await it
const proxyRoom = { code: 'P', match: { hosted: true, adminEdit: async (pid, cmd, args) => cmd === 'funds' ? { ok: true, funds: args.amount } : { ok: true, round: args.round } } };
ok((await editFunds(proxyRoom, 'p_0', 42)).funds === 42, 'hosted 代理 editFunds 经异步 adminEdit');
ok((await editRound(proxyRoom, 6)).round === 6, 'hosted 代理 editRound 经异步 adminEdit');

m.dispose();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
