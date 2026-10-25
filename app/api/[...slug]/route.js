import legacyHandler from '../../../api/index.mjs';

function createNodeRequest(request) {
  const url = new URL(request.url);
  const bodyText = request.method === 'GET' || request.method === 'HEAD' ? '' : request.headers.get('content-type') ? request.body ? '' : '' : '';
  return {
	method: request.method,
	url: url.href,
	headers: Object.fromEntries(request.headers.entries()),
	body: undefined,
	async *[Symbol.asyncIterator]() {
	  const raw = await request.text();
	  if (raw) yield Buffer.from(raw);
	}
  };
}

function createNodeResponse() {
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
	getHeader(name) {
	  return headers[name];
	},
	headers
  };
  return { res, chunks };
}

async function proxyRequest(request) {
  const rawBody = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  const req = {
	method: request.method,
	url: new URL(request.url).href,
	headers: Object.fromEntries(request.headers.entries()),
	body: rawBody === undefined ? undefined : rawBody
  };
  const { res, chunks } = createNodeResponse();
  await legacyHandler(req, res);
  const buffer = Buffer.concat(chunks.length ? chunks : [Buffer.from('')]);
  const response = new Response(buffer, { status: res.statusCode || 200 });
  for (const [name, value] of Object.entries(res.headers)) {
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

export async function PUT(request) {
  return proxyRequest(request);
}

export async function DELETE(request) {
  return proxyRequest(request);
}

export async function PATCH(request) {
  return proxyRequest(request);
}
