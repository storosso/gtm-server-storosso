
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  // GTM Server Collection Endpoint
  if (pathname === '/collect' || pathname === '/g/collect') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method Not Allowed');
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body || body.trim().length === 0) {
        console.error('❌ Empty or invalid JSON body');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Invalid body');
      }

      try {
        const json = JSON.parse(body);
        console.log('✅ Received event:', JSON.stringify(json, null, 2));
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('Event received');
      } catch (e) {
        console.error('❌ JSON parse error:', e.message);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Invalid JSON');
      }
    });

    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`✅ GTM Server running on port ${PORT}`);
});
