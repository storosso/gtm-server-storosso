// server.js – Meta + TikTok forwarder (Railway) – v1.3 compat (int event_time)

const http = require('http');
const url = require('url');
const https = require('https');

const PORT = Number(process.env.PORT) || 8080;

// ---------- META (Facebook) env ----------
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;
const META_TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || '';

if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) {
  console.warn('⚠️ FB_PIXEL_ID or FB_ACCESS_TOKEN missing in env!');
}

// ---------- TIKTOK env ----------
const TIKTOK_PIXEL_ID = process.env.TIKTOK_PIXEL_ID;           // ex. D2TVRQBC7U1Q4B3YJQ0
const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN;   // Events API access token
const TIKTOK_TEST_EVENT_CODE = process.env.TIKTOK_TEST_EVENT_CODE || '';

if (!TIKTOK_PIXEL_ID || !TIKTOK_ACCESS_TOKEN) {
  console.warn('⚠️ TIKTOK_PIXEL_ID or TIKTOK_ACCESS_TOKEN missing in env!');
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

  // Root & healthz
  if (pathname === '/' || pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }

  if (pathname === '/collect' || pathname === '/g/collect') {
    const ct = (req.headers['content-type'] || '').toLowerCase();
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

      // ---- helpers (common) ----
      const nameMap = {
        view_content:'ViewContent', add_to_cart:'AddToCart',
        begin_checkout:'BeginCheckout', initiate_checkout:'InitiateCheckout',
        purchase:'Purchase', page_view:'PageView'
      };
      const normEventName = n => n ? (nameMap[String(n).toLowerCase()] || n) : 'CustomEvent';
      const num = x => {
        if (typeof x === 'number') return x;
        if (x == null) return 0;
        const s = String(x).replace(/[^\d.,-]/g,'').replace(/\.(?=.*\.)/g,'').replace(',','.');
        const v = parseFloat(s); return isNaN(v) ? 0 : v;
      };

      // --- split by platform ---
      const toTikTok = [];
      const toMeta   = [];
      for (const ev of events) {
        const platform = String(ev.platform || 'meta').toLowerCase();
        if (platform === 'tiktok') toTikTok.push(ev);
        else toMeta.push(ev);
      }

      // ---- forward (both possible) ----
      const jobs = [];

      if (toMeta.length) {
        jobs.push(forwardToMeta({
          events: toMeta,
          normEventName, num, realIp, reqUA: (req.headers['user-agent'] || '')
        }));
      }

      if (toTikTok.length) {
        jobs.push(forwardToTikTok({
          events: toTikTok,
          normEventName, num, realIp, reqUA: (req.headers['user-agent'] || '')
        }));
      }

      try {
        const results = await Promise.all(jobs);
        const payload = {};
        for (const r of results) {
          payload[r.platform] = {
            status: r.statusCode,
            body: tryParseJSON(r.body)
          };
        }
        const status = results.some(r => (r.statusCode >= 400)) ? 207 : 200;
        safeEnd(res, status, JSON.stringify(payload), 'application/json');
      } catch (err) {
        console.error('❌ Forward error:', err);
        safeEnd(res, 502, JSON.stringify({error:'forward_failed', message: String(err && err.message || err)}), 'application/json');
      }
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
});

server.listen(PORT, () => {
  console.log(`# GTM Server running on port ${PORT}`);
});

// graceful logs
process.on('SIGTERM', () => { console.log('🔻 SIGTERM received'); process.exit(0); });
process.on('SIGINT',  () => { console.log('🔻 SIGINT received');  process.exit(0); });

function safeEnd(res, code, msg, type='text/plain') {
  if (!res.headersSent) res.writeHead(code, { 'Content-Type': type });
  res.end(msg);
}
function tryParseJSON(s){ try { return JSON.parse(s); } catch(_) { return s; } }

// ----------------- FORWARDERS -----------------

function forwardToMeta(ctx){
  return new Promise((resolve, reject) => {
    const { events, normEventName, num, realIp, reqUA } = ctx;

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
        client_user_agent: p.user_data?.client_user_agent || reqUA,
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
        resolve({ platform:'meta', statusCode: fbRes.statusCode, body: fbData });
      });
    });

    fbReq.on('timeout', () => { console.error('❌ Meta request timeout'); fbReq.destroy(new Error('timeout')); });
    fbReq.on('error', err => { console.error('❌ Meta request error:', err); reject(err); });

    fbReq.write(JSON.stringify(metaBody));
    fbReq.end();
  });
}

function forwardToTikTok(ctx){
  return new Promise(async (resolve, reject) => {
    const { events, normEventName, num, realIp, reqUA } = ctx;

    try {
      console.log('TT v1.3-compat (int event_time)');

      const tkEvents = events.map(p => {
        // sec (integer) pentru compat, ISO pentru v1.3
        const sec = Number(p.event_time || Math.floor(Date.now()/1000));
        const iso = new Date(sec * 1000).toISOString();
        const evName = normEventName(p.event_name || 'CustomEvent');

        const itemsSrc = p.custom_data?.contents || [];
        const items = (Array.isArray(itemsSrc) ? itemsSrc : []).map(i => ({
          content_id:  i.content_id || i.id || i.item_id || 'unknown',
          content_name:i.content_name || i.name || undefined,
          quantity:    Number(i.quantity || 1),
          price:       num(i.price != null ? i.price : i.item_price)
        }));

        const ad = (p.user_data && p.user_data.ttclid) ? { callback: p.user_data.ttclid } : undefined;

        return {
          // v1.3
          event: evName,
          timestamp: iso,

          // compat cu validarea care cere integer
          event_type: evName,
          event_time: sec,

          event_id: p.event_id || undefined,
          context: {
            ...(ad ? { ad } : {}),
            page: { url: p.event_source_url || '', referrer: p.referrer || '' },
            user: {
              external_id: p.user_data?.external_id || undefined,
              email:       p.user_data?.em || undefined,
              phone:       p.user_data?.ph || undefined,
              ip:          p.user_data?.client_ip_address || realIp || undefined,
              user_agent:  p.user_data?.client_user_agent || reqUA || undefined
            }
          },
          properties: {
            currency:     p.custom_data?.currency || 'EUR',
            value:        num(p.custom_data?.value),
            order_id:     p.custom_data?.order_id,
            content_type: p.custom_data?.content_type || 'product',
            contents:     items
          }
        };
      });

      const body = {
        event_source: 'web',
        event_source_id: TIKTOK_PIXEL_ID,
        data: tkEvents,
        ...(TIKTOK_TEST_EVENT_CODE ? { test_event_code: TIKTOK_TEST_EVENT_CODE } : {})
      };

      console.log('📦 Sending to TikTok:\n' + JSON.stringify(body, null, 2));

      const options = {
        hostname: 'business-api.tiktok.com',
        path: '/open_api/v1.3/event/track/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': TIKTOK_ACCESS_TOKEN
        },
        timeout: 15000
      };

      const tkBody = await httpRequestJSON(options, body);
      console.log('🟦 TikTok response:', tkBody.statusCode, tkBody.body);
      resolve({ platform:'tiktok', statusCode: tkBody.statusCode, body: tkBody.body });

    } catch (err) {
      console.error('❌ TikTok send error:', err);
      reject(err);
    }
  });
}

function httpRequestJSON(options, payload){
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}
