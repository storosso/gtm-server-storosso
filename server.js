const http = require('http');
const url = require('url');
const https = require('https');

const PORT = Number(process.env.PORT) || 8080;
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  if (pathname === '/collect' || pathname === '/g/collect') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' });
      return res.end('Method Not Allowed');
    }

    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      console.log('🔍 Raw Headers:', req.headers);
      console.log('📥 Raw Body:', body);

      if (!body || body.trim().length === 0) {
        console.error('❌ Empty request body');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing or empty body');
      }

      try {
        const parsed = JSON.parse(body);
        console.log('✅ Parsed event:\n', JSON.stringify(parsed, null, 2));

        const event_name = parsed.event_name || 'unknown';
        const event_time = parsed.event_time || Math.floor(Date.now() / 1000);
        const event_source_url = parsed.event_source_url || '';
        const action_source = parsed.action_source || 'website';

        const items = parsed.items || parsed.ecommerce?.items || [];
        const contents = parsed.custom_data?.contents?.length
          ? parsed.custom_data.contents
          : items.map(item => ({
              id: item.item_id || item.id || 'unknown',
              quantity: item.quantity || 1,
              item_price: item.price || 0
            }));

        const content_ids = parsed.custom_data?.content_ids?.length
          ? parsed.custom_data.content_ids
          : contents.map(c => c.id);

        const valueFromContents = contents.reduce((sum, c) => {
          const q = Number(c.quantity || 1);
          const p = Number(c.item_price || 0);
          return sum + (q * p);
        }, 0);

        const custom_data = {
          value: parsed.custom_data?.value || valueFromContents,
          currency: parsed.custom_data?.currency || 'EUR',
          content_name: parsed.custom_data?.content_name || '',
          content_category: parsed.custom_data?.content_category || '',
          content_ids,
          contents,
          ...parsed.custom_data
        };

        const user_data = {
          em: parsed.user_data?.em || '',
          client_ip_address: parsed.user_data?.client_ip_address || req.socket.remoteAddress || '',
          client_user_agent: parsed.user_data?.client_user_agent || req.headers['user-agent'] || '',
          fbp: parsed.user_data?.fbp || '',
          fbc: parsed.user_data?.fbc || ''
        };

        const payload = {
          data: [
            {
              event_name,
              event_time,
              event_source_url,
              action_source,
              user_data,
              custom_data
            }
          ]
        };

        console.log('📦 Payload to Meta:\n', JSON.stringify(payload, null, 2));

        const options = {
          hostname: 'graph.facebook.com',
          path: `/v17.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        };

        const fbReq = https.request(options, fbRes => {
          let fbData = '';
          fbRes.on('data', chunk => fbData += chunk);
          fbRes.on('end', () => {
            console.log(`📬 Meta response [${fbRes.statusCode}]:\n${fbData}`);
            res.writeHead(fbRes.statusCode, { 'Content-Type': 'application/json' });
            res.end(fbData);
          });
        });

        fbReq.on('error', err => {
          console.error('❌ Meta API error:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Meta API error');
        });

        fbReq.write(JSON.stringify(payload));
        fbReq.end();

      } catch (err) {
        console.error('❌ JSON parse error:', err.message);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid JSON');
      }
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`🚀 Debug Server running on port ${PORT}`);
});
