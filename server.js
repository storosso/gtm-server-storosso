const http  = require('http');
const url   = require('url');
const https = require('https');

const PORT            = Number(process.env.PORT) || 8080;
const FB_PIXEL_ID     = process.env.FB_PIXEL_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true);

  // CORS & Preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Healthcheck
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  // Main endpoint
  if (pathname === '/collect' || pathname === '/g/collect') {
    // ✅ Verifică Content-Type
    if (req.headers['content-type'] !== 'application/json') {
      res.writeHead(415).end('Unsupported Media Type');
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log('📥 Raw Body:', body);
      if (!body.trim()) {
        console.error('❌ Empty request body');
        res.writeHead(400).end('Missing body');
        return;
      }

      let p;
      try {
        p = JSON.parse(body);
      } catch (e) {
        console.error('❌ JSON parse error:', e.message);
        res.writeHead(400).end('Invalid JSON');
        return;
      }

      // ✅ Fallback pentru IP real
      const realIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

      // ✅ Construiește contents și payload
      const contents = (p.custom_data?.contents || p.ecommerce?.add?.products || []).map(i => ({
        id:         i.id || i.item_id || 'unknown',
        quantity:   i.quantity || 1,
        item_price: i.item_price || i.price || 0
      }));

      const payload = {
        data: [{
          event_name:       p.event_name       || 'unknown',
          event_time:       p.event_time       || Math.floor(Date.now() / 1000),
          event_source_url: p.event_source_url || '',
          action_source:    p.action_source    || 'website',
          user_data: {
            em:                p.user_data?.em                || '',
            client_ip_address: p.user_data?.client_ip_address || realIp,
            client_user_agent: p.user_data?.client_user_agent || req.headers['user-agent'],
            fbp:               p.user_data?.fbp               || '',
            fbc:               p.user_data?.fbc               || ''
          },
          custom_data: {
            value:       p.custom_data?.value ?? contents.reduce((s, c) => s + c.quantity * c.item_price, 0),
            currency:    p.custom_data?.currency || p.ecommerce?.currencyCode || 'EUR',
            content_ids: p.custom_data?.content_ids || contents.map(c => c.id),
            contents
          }
        }]
      };

      // ✅ Log payload complet
      console.log('📦 Sending to Meta:\n', JSON.stringify(payload, null, 2));

      const opts = {
        hostname: 'graph.facebook.com',
        path:     `/v18.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
        method:   'POST',
        headers:  { 'Content-Type': 'application/json' },
        timeout:  5000
      };
      console.log('🚀 Meta request options:', opts);

      const fbReq = https.request(opts, fbRes => {
        console.log(`📬 Meta statusCode: ${fbRes.statusCode}`);
        console.log('📋 Meta headers:', fbRes.headers);

        let fbData = '';
        fbRes.on('data', d => {
          fbData += d;
          console.log('🔹 Meta chunk:', d.toString());
        });

        fbRes.on('end', () => {
          console.log('✅ Meta response complete:', fbData);
          res.writeHead(fbRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(fbData);
        });
      });

      fbReq.on('timeout', () => {
        console.error('❌ Meta request timeout');
        fbReq.abort();
        res.writeHead(504).end('Meta timeout');
      });

      fbReq.on('error', err => {
        console.error('❌ Meta request error:', err);
        res.writeHead(502).end('Meta error');
      });

      fbReq.write(JSON.stringify(payload));
      fbReq.end();
    });

    return;
  }

  res.writeHead(404).end('Not Found');
});

server.listen(PORT, () => {
  console.log(`🛰 GTM Meta Server running on port ${PORT}`);
});
