// ponytail: یک فایل. reverse proxy برای generativelanguage.googleapis.com.
// مشکل: sandbox از IP ایران 403 می‌گیرد؛ این سرور روی VibeNest (IP خارج) اجرا می‌شود.
// ceiling: فقط generativelanguage را proxy می‌کند؛ اگر روزی providerهای دیگر هم از همین IP
// محدود شوند، همان مسیر /proxy/<host> با لیست allowlist کافیست.
import http from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

const PORT = process.env.PORT || 8080;
const KEY_HEADER = 'x-api-key';

// فقط این هاست‌ها مجازند (allowlist — جلوگیری از open proxy)
const ALLOWED = new Set([
  'generativelanguage.googleapis.com',
]);

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  // مسیر سلامت + استفاده
  if (u.pathname === '/' || u.pathname === '/healthz') {
    return send(res, 200, {
      ok: true,
      service: 'gemini-bridge',
      usage: 'GET|POST /proxy/generativelanguage.googleapis.com/v1beta/...  header: x-api-key: <KEY>',
      note: 'IP این سرور از سوی گوگل محدود نیست — درخواست‌ها را pass می‌کند',
    });
  }

  // /proxy/<host>/<path...>
  const m = u.pathname.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (!m) {
    return send(res, 404, { error: 'unknown route', hint: 'use /proxy/<host>/path' });
  }
  const host = m[1];
  const rest = m[2] || '/';
  if (!ALLOWED.has(host)) {
    return send(res, 403, { error: `host not allowed: ${host}`, allowed: [...ALLOWED] });
  }

  // کلید: header یا query (?key=)
  const apiKey = req.headers[KEY_HEADER] || u.searchParams.get('key');
  if (!apiKey) {
    return send(res, 401, { error: 'missing x-api-key header or ?key=' });
  }

  // بدنه درخواست
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  const target = new URL(rest, `https://${host}`);
  target.search = u.search; // نگه داشتن query string (شامل key)
  if (!target.searchParams.get('key')) target.searchParams.set('key', apiKey);

  const opts = {
    method: req.method,
    hostname: target.hostname,
    path: target.pathname + target.search,
    headers: {
      'content-type': req.headers['content-type'] || 'application/json',
      'accept': req.headers['accept'] || 'application/json',
      'user-agent': 'gemini-bridge/1.0',
    },
  };
  if (body.length) opts.headers['content-length'] = body.length;

  const up = httpsRequest(opts, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', (e) => send(res, 502, { error: 'upstream error', detail: String(e.message) }));
  if (body.length) up.write(body);
  up.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`gemini-bridge on :${PORT}`);
});
