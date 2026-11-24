// test-account-plus.mjs — module-level tests for device limit, guest conversion, email register/login. Run: node test-account-plus.mjs
import { createAuth } from './server/auth/auth.js';
import { randPass } from './_test-creds.mjs'; // [auth-fork]
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l} ${x}`); } };
const PW = randPass();   // random per run; no fixed password committed
const DB = './server/auth/test-plus-' + Date.now() + '.db';
const a = createAuth({ dbPath: DB });
const fut = Date.now() + 600000;

console.log('[设备指纹：同设备引导登录]');
const r1 = a.register('设备甲', '', { mode: 'token', deviceFp: 'devA' });
ok(r1.ok, '首次注册成功');
const r2 = a.register('设备乙', '', { mode: 'token', deviceFp: 'devA' });
ok(!r2.ok && r2.error === 'device_has_account', '同设备再注册被拦', r2.error);
ok(r2.existing && r2.existing.name === '设备甲', '返回已有账号名引导登录', r2.existing?.name);
ok(a.deviceCheck('devA').hasAccount === true, 'deviceCheck 命中');
ok(a.deviceCheck('devNEW').hasAccount === false, '新设备不命中');
const r3 = a.register('设备丙', '', { mode: 'token', deviceFp: 'devB' });
ok(r3.ok, '不同设备可注册');

console.log('[游客转正：保留名字]');
const g = a.guest('星际游客');
ok(g.ok, '游客通行证');
const cv = a.convertGuest(g.token, { mode: 'token', deviceFp: 'devG' });
ok(cv.ok && cv.account.name === '星际游客', '转正保留游客名字', cv.account?.name);
ok(cv.account.tag && /#\d+$/.test(cv.account.tag), '转正带编号');
const cv2 = a.convertGuest(g.token, { mode: 'token' });
ok(!cv2.ok && cv2.error === 'need_guest', '旧游客 token 已失效');
const gp = a.guest('密码游客');
const cvp = a.convertGuest(gp.token, { mode: 'password', password: PW, deviceFp: 'devGP' });
ok(cvp.ok && cvp.mode === 'password', '游客转正设密码');
ok(a.login('密码游客', PW, { mode: 'password' }).ok || a.store.accountByName('密码游客'), '密码账号存在');

console.log('[邮箱注册/登录]');
ok(a.emailConfigured === false, '未配置 SMTP 时 emailConfigured=false');
a.sendEmailCode('x@y.com', 'register').then((s) => ok(!s.ok && s.error === 'email_not_configured', '未配置时发码返回 email_not_configured'));
a.store.putCode('mail@x.com', '123456', 'register', fut);
const er = a.register('邮箱用户', PW, { mode: 'email', email: 'mail@x.com', code: '123456', deviceFp: 'devM' });
ok(er.ok && er.account.email === 'mail@x.com', '邮箱+验证码+密码注册', er.error);
ok(a.login('', PW, { mode: 'password', email: 'mail@x.com' }).ok, '邮箱+密码登录');
a.store.putCode('mail@x.com', '654321', 'login', fut);
ok(a.login('', '', { mode: 'email-code', email: 'mail@x.com', code: '654321' }).ok, '邮箱+验证码免密登录');
a.store.putCode('mail@x.com', '111111', 'login', fut);
const bad = a.login('', '', { mode: 'email-code', email: 'mail@x.com', code: '999999' });
ok(!bad.ok && bad.error === 'bad_code', '错误验证码被拒');
a.store.putCode('dup@x.com', '222222', 'register', fut);
const dup = a.register('邮箱重复', PW, { mode: 'email', email: 'mail@x.com', code: '222222', deviceFp: 'devDup' });
ok(!dup.ok && dup.error === 'email_taken', '邮箱已注册被拒');

setTimeout(() => { a.close(); console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0); }, 300);
