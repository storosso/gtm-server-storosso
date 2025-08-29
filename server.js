const http = require('http');
const url = require('url');
const https = require('https');

const PORT = Number(process.env.PORT) || 8080;
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';

if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) {
  console.warn('⚠️ FB_PIXEL_ID or FB_ACCESS_TOKEN missing in env!');
}

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true);

  // ---------- CORS ----------
  const origin = req.headers.origin || '';
  res.setHeader('Vary', 'Origin');
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,HEAD');
  res.setHeader(
    'Access-Control-Allow-Headers',
    req.headers['access-control-request-headers'] || 'Content-Type'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS' || req.method === 'HEAD') {
    res.writeHead(204); return res.end();
  }
  // --------------------------

  // Root & healthz -> 200 (pt. Railway health-check)
  if (pathname === '/' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  if (pathname === '/collect' || pathname === '/g/collect') {
    const ct = (req.headers['content-type'] || '').toLowerCase();
    // acceptă JSON (cu charset) și text/plain (pentru sendBeacon)
    if (!(ct.startsWith('application/json') || ct.startsWith('text/plain'))) {
      res.writeHead(415, { 'Content-Type': 'text/plain' });
      return res.end('Unsupported Media Type');
    }

    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', async () => {
      console.log('📥 Raw Body:', raw);
      if (!raw.trim()) return safeEnd(res, 400, 'Missing body');

      let incoming;
      try { incoming = JSON.parse(raw); }
      catch (e) { console.error('❌ JSON parse error:', e.message); return safeEnd(res, 400, 'Invalid JSON'); }

      const events = Array.isArray(incoming?.data) ? incoming.data : [incoming];
      const realIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket.remoteAddress || '';

      const nameMap = {
        view_content:'ViewContent', add_to_cart:'AddToCart',
        begin_checkout:'BeginCheckout', purchase:'Purchase',
        page_view:'PageView'
      };
      const normEventName = n => n ? (nameMap[String(n).toLowerCase()] || n) : 'CustomEvent';
      const num = x => {
        if (typeof x === 'number') return x;
        if (x == null) return 0;
        const s = String(x).replace(/[^\d.,-]/g,'').replace(/\.(?=.*\.)/g,'').replace(',','.');
        const v = parseFloat(s); return isNaN(v) ? 0 : v;
      };

      const metaEvents = events.map(p => {
        const contentsSrc = p.custom_data?.contents || p.ecommerce?.add?.products || [];
        const contents = (Array.isArray(contentsSrc) ? contentsSrc : []).map(i => ({
          id: i.id || i.item_id || 'unknown',
          quantity: Number(i.quantity || 1),
          item_price: num(i.item_price != null ? i.item_price : i.price)
        }));

        const user_data = {
          ...(p.user_data?.em ? { em: p.user_data.em } : {}),
          ...(p.user_data?.ph ? { ph: p.user_data.ph } : {}),
          ...(p.user_data?.external_id ? { external_id: p.user_data.external_id } : {}),
          client_ip_address: p.user_data?.client_ip_address || realIp,
          client_user_agent: p.user_data?.client_user_agent || req.headers['user-agent'] || '',
          fbp: p.user_data?.fbp || '',
          fbc: p.user_data?.fbc || ''
        };

        const value = (p.custom_data?.value != null)
          ? num(p.custom_data.value)
          : contents.reduce((s,c)=> s + Number(c.quantity) * num(c.item_price), 0);

        const currency = p.custom_data?.currency || p.ecommerce?.currencyCode || 'EUR';
        const content_ids = Array.isArray(p.custom_data?.content_ids)
          ? p.custom_data.content_ids
          : contents.map(c=>c.id);

        return {
          event_name: normEventName(p.event_name || 'CustomEvent'),
          event_time: Number(p.event_time || Math.floor(Date.now()/1000)),
          event_source_url: p.event_source_url || '',
          action_source: p.action_source || 'website',
          event_id: p.event_id || undefined,
          user_data,
          custom_data: {
            value, currency,
            content_type: p.custom_data?.content_type || 'product',
            content_ids, contents
          }
        };
      });

      const metaBody = {
        data: metaEvents,
        access_token: FB_ACCESS_TOKEN,
        partner_agent: 'storosso-gtm-railway-ss'
      };
      if (META_TEST_EVENT_CODE) metaBody.test_event_code = META_TEST_EVENT_CODE;

      console.log('📦 Sending to Meta:\n' + JSON.stringify(metaBody, null, 2));

      const options = {
        hostname: 'graph.facebook.com',
        path: `/v20.0/${FB_PIXEL_ID}/events`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      };

      const fbReq = https.request(options, fbRes => {
        let fbData = '';
        fbRes.on('data', d => (fbData += d));
        fbRes.on('end', () => {
          console.log('📬 Meta statusCode:', fbRes.statusCode);
          console.log('📋 Meta headers:', fbRes.headers);
          console.log('🟪 Meta response body:', fbData);
          safeEnd(res, fbRes.statusCode, fbData, 'application/json');
        });
      });

      fbReq.on('timeout', () => { console.error('❌ Meta request timeout');
        fbReq.destroy(new Error('timeout')); safeEnd(res, 504, 'Meta timeout'); });

      fbReq.on('error', err => { console.error('❌ Meta request error:', err);
        safeEnd(res, 502, 'Meta error'); });

      fbReq.write(JSON.stringify(metaBody));
      fbReq.end();
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
});

server.listen(PORT, () => {
  console.log(`# GTM Meta Server running on port ${PORT}`);
});

// graceful logs (utile dacă Railway trimite SIGTERM)
process.on('SIGTERM', () => { console.log('🔻 SIGTERM received'); process.exit(0); });
process.on('SIGINT',  () => { console.log('🔻 SIGINT received');  process.exit(0); });

function safeEnd(res, code, msg, type='text/plain') {
  if (!res.headersSent) res.writeHead(code, { 'Content-Type': type });
  res.end(msg);
}
