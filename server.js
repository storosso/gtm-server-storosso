const http = require('http');
const url = require('url');

const PORT = Number(process.env.PORT) || 8080;

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  // GTM collect routes
  if (pathname === '/collect' || pathname === '/g/collect') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method Not Allowed');
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      if (!body || body.trim().length === 0) {
        console.error('❌ Empty request body');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing or empty body');
      }

      try {
        const parsed = JSON.parse(body);
        console.log('✅ Parsed event:', parsed);

        // Forward to GTM Server Container (your tag does the rest)
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('OK');
      } catch (err) {
        console.error('❌ Failed to parse JSON:', err.message);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Invalid JSON');
      }
    });

    return;
  }

  // All other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
});
