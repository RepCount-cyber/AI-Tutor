import { NextResponse } from 'next/server';

export function proxy(request) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self'",
    "media-src 'self' blob:"
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  // Next reads the request policy and adds this nonce to its hydration scripts.
  requestHeaders.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}
