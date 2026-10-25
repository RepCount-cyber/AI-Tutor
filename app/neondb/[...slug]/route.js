import legacyHandler from '../../../api/index.mjs';

async function proxyRequest(request) {
  const rawBody = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  const req = {
	method: request.method,
	url: new URL(request.url).href,
	headers: Object.fromEntries(request.headers.entries()),
	body: rawBody === undefined ? undefined : rawBody
  };
  const headers = {};
  const chunks = [];
  const res = {
	statusCode: 200,
	setHeader(name, value) {
	  headers[name] = value;
	},
	write(chunk) {
	  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	  return true;
	},
	end(chunk) {
	  if (chunk !== undefined) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	  }
	},
	headers
  };

  await legacyHandler(req, res);
  const buffer = Buffer.concat(chunks.length ? chunks : [Buffer.from('')]);
  const response = new Response(buffer, { status: res.statusCode || 200 });
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) response.headers.append(name, String(item));
  }
  return response;
}

export async function GET(request) {
  return proxyRequest(request);
}

export async function POST(request) {
  return proxyRequest(request);
}
