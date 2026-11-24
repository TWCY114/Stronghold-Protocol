// _test-creds.mjs — [auth-fork] test credentials helpers. No fixed password is committed: the admin password comes from
// the environment (SP_TEST_ADMIN_PASSWORD, matching the local test DB seeded via seed-admin.mjs); other tests generate a
// random password per run. The test databases themselves (server/auth/*.db) are never committed.
import { randomBytes } from 'node:crypto';
export function adminPass() {
  const p = process.env.SP_TEST_ADMIN_PASSWORD;
  if (!p) { console.error('✗ 需设置环境变量 SP_TEST_ADMIN_PASSWORD（本地测试库管理员密码，由 seed-admin.mjs 设定，不入库）'); process.exit(1); }
  return p;
}
export const randPass = () => 'T' + randomBytes(9).toString('hex') + 'aA1!';
