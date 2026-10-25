import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import handler from '../api/index.mjs';

const root = fileURLToPath(new URL('../public', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'; media-src 'self' blob:";
const localBypass = process.env.LOCAL_AUTH_BYPASS === 'true';
createServer(async (req,res) => {
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Content-Security-Policy',csp);
  if (req.url.startsWith('/api/') || req.url.startsWith('/neondb/')) {
    if (localBypass && req.url.startsWith('/api/google/start')) {
      res.statusCode = 302;
      res.setHeader('Location', '/demo.html?view=parent');
      return res.end();
    }
    return handler(req,res);
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const safePathname = localBypass && (pathname === '/' || pathname === '/index.html') ? '/demo.html' : pathname;
    const path = resolve(root, '.' + (safePathname === '/' ? '/demo.html' : safePathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) throw new Error('missing');
    res.setHeader('Content-Type',types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end('Not found'); }
}).listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Family Tutor is running on http://localhost:${Number(process.env.PORT) || 3000}${localBypass ? ' (local auth bypass enabled)' : ''}`));
