const http = require('http');
const url = require('url');
const https = require('https');

const PORT              = Number(process.env.PORT) || 8080;
const FB_PIXEL_ID       = process.env.FB_PIXEL_ID;
const FB_ACCESS_TOKEN   = process.env.FB_ACCESS_TOKEN;

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
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('🔍 Raw Headers:', req.headers);
      console.log('📥 Raw Body:', body);

      if (!body.trim()) {
        console.error('❌ Empty request body');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing or empty body');
      }

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch (err) {
        console.error('❌ JSON parse error:', err.message);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Invalid JSON');
      }

      console.log('✅ Parsed event:', JSON.stringify(parsed, null, 2));

      // Normalize fields
      const event_name       = parsed.event_name || 'unknown';
      const event_time       = parsed.event_time || Math.floor(Date.now() / 1000);
      const event_source_url = parsed.event_source_url || '';
      const action_source    = parsed.action_source || 'website';

      // Build contents array
      const items = parsed.custom_data?.contents ||
                    parsed.ecommerce?.add?.products ||
                    [];
      const contents = items.map(item => ({
        id:           item.id   || item.item_id   || 'unknown',
        quantity:     item.quantity   || 1,
        item_price:   item.price      || item.item_price || 0
      }));

      const content_ids = parsed.custom_data?.content_ids ||
                          contents.map(c => c.id);

      const valueFromContents = contents
        .reduce((sum, c) => sum + (c.quantity * c.item_price), 0);

      const custom_data = {
        value:            parsed.custom_data?.value    || valueFromContents,
        currency:         parsed.custom_data?.currency || parsed.ecommerce?.currencyCode || 'EUR',
        content_ids,
        contents,
        ...parsed.custom_data
      };

      const user_data = {
        em:                  parsed.user_data?.em                || '',
        client_ip_address:   parsed.user_data?.client_ip_address || req.socket.remoteAddress || '',
        client_user_agent:   parsed.user_data?.client_user_agent || req.headers['user-agent'] || '',
        fbp:                 parsed.user_data?.fbp               || '',
        fbc:                 parsed.user_data?.fbc               || ''
      };

      const payload = {
        data: [{
          event_name,
          event_time,
          event_source_url,
          action_source,
          user_data,
          custom_data
        }]
      };

      console.log('📦 Payload to Meta:', JSON.stringify(payload, null, 2));

      // Send to Meta CAPI
      const options = {
        hostname: 'graph.facebook.com',
        path:     `/v17.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json' }
      };

      const fbReq = https.request(options, fbRes => {
        let fbData = '';
        fbRes.on('data', chunk => fbData += chunk);
        fbRes.on('end', () => {
          console.log(`📬 Meta response [${fbRes.statusCode}]:`, fbData);
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
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`🚀 Debug Server running on port ${PORT}`);
});
