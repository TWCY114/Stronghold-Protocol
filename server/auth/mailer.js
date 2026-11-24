// server/auth/mailer.js — a dependency-free SMTP sender for e-mail verification codes (account-plus). Configured entirely
// from the environment so the operator plugs in their own SMTP server without a code change:
//   SP_SMTP_HOST, SP_SMTP_PORT (default 465), SP_SMTP_USER, SP_SMTP_PASS, SP_SMTP_FROM (default USER),
//   SP_SMTP_SECURE ('1' implicit TLS / '0' STARTTLS; default: secure when port 465).
// Until configured, sendMail resolves {ok:false, error:'email_not_configured'} so the UI can say "邮箱功能未开启".
// Supports implicit TLS (465) and STARTTLS (587), AUTH LOGIN. Server-only (node:net/tls), never imported by server/sim.

import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export function createMailer({ log } = {}) {
  const host = process.env.SP_SMTP_HOST || '';
  const port = Number(process.env.SP_SMTP_PORT || 465);
  const user = process.env.SP_SMTP_USER || '';
  const pass = process.env.SP_SMTP_PASS || '';
  const from = process.env.SP_SMTP_FROM || user;
  const secure = process.env.SP_SMTP_SECURE != null ? process.env.SP_SMTP_SECURE === '1' : port === 465;
  const configured = Boolean(host && user && pass);

  /** Send a plain-text mail. Resolves {ok:true} or {ok:false, error, detail?}; never rejects. */
  function sendMail({ to, subject, text }) {
    if (!configured) return Promise.resolve({ ok: false, error: 'email_not_configured' });
    return new Promise((resolve) => {
      let sock = null, buf = '', pending = null, done = false;
      const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { sock && sock.destroy(); } catch { /* ignore */ } resolve(r); };
      const timer = setTimeout(() => finish({ ok: false, error: 'smtp_timeout' }), 25000);
      const feed = (chunk) => {
        buf += chunk.toString('utf8');
        const m = buf.match(/(?:^|\n)(\d{3}) [^\n]*\n/);   // a complete SMTP response ends with a "NNN <text>" line
        if (m && pending) { const code = Number(m[1]); const resp = buf; buf = buf.slice(m.index + m[0].length); const p = pending; pending = null; p([code, resp]); }
      };
      const wait = () => new Promise((res) => { pending = res; });
      const send = (s) => sock.write(s + '\r\n');
      const expect = async (codes) => { const [code, resp] = await wait(); if (!codes.includes(code)) throw new Error('smtp ' + code + ' ' + resp.slice(0, 120)); return resp; };
      const attach = (s) => { sock = s; s.on('data', feed); s.on('error', (e) => finish({ ok: false, error: 'smtp_error', detail: String(e.message || e) })); };
      (async () => {
        try {
          if (secure) {
            attach(tlsConnect({ host, port, servername: host, rejectUnauthorized: false }));
            await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
          } else {
            attach(netConnect({ host, port }));
            await new Promise((res, rej) => { sock.once('connect', res); sock.once('error', rej); });
          }
          await expect([220]);
          send('EHLO localhost'); await expect([250]);
          if (!secure) {   // STARTTLS upgrade
            send('STARTTLS'); await expect([220]);
            const plain = sock; sock = null;
            await new Promise((res, rej) => { const t = tlsConnect({ socket: plain, servername: host, rejectUnauthorized: false }, () => { attach(t); res(); }); t.once('error', rej); });
            send('EHLO localhost'); await expect([250]);
          }
          send('AUTH LOGIN'); await expect([334]);
          send(Buffer.from(user).toString('base64')); await expect([334]);
          send(Buffer.from(pass).toString('base64')); await expect([235]);
          send('MAIL FROM:<' + from + '>'); await expect([250]);
          send('RCPT TO:<' + to + '>'); await expect([250, 251]);
          send('DATA'); await expect([354]);
          const msg = ['From: ' + from, 'To: ' + to, 'Subject: ' + subject, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', text, '.'].join('\r\n');
          sock.write(msg + '\r\n'); await expect([250]);
          send('QUIT');
          finish({ ok: true });
        } catch (e) { log?.error?.('[mailer] send failed', e); finish({ ok: false, error: 'smtp_failed', detail: String(e.message || e) }); }
      })();
    });
  }

  return { configured, sendMail };
}
