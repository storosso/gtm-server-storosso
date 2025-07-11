const http = require('http');
const url = require('url');
const https = require('https');

const PORT = Number(process.env.PORT) || 8080;
const FB_PIXEL_ID = process.env.FB_PIXEL_ID;
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true);

  // CORS
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
    req.on('data', chunk => (body += chunk.toString()));
    req.on('end', () => {
      if (!body || body.trim().length === 0) {
        console.error('❌ Empty request body');
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing or empty body');
      }

      try {
        const parsed = JSON.parse(body);
        console.log('✅ Parsed event:', parsed);

        const event_name = parsed.event_name || 'PageView';
        const event_time = parsed.event_time || Math.floor(Date.now() / 1000);
        const event_source_url = parsed.event_source_url || '';
        const action_source = parsed.action_source || 'website';

        const user_data = {
          em: parsed.user_data?.em,
          ph: parsed.user_data?.ph,
          fbp: parsed.user_data?.fbp,
          fbc: parsed.user_data?.fbc,
          client_ip_address: parsed.user_data?.client_ip_address,
          client_user_agent: parsed.user_data?.client_user_agent
        };

        const custom_data = {
          currency: parsed.custom_data?.currency || parsed.currency || 'EUR',
          value: parsed.custom_data?.value || parsed.value || 0,
          content_ids: parsed.custom_data?.content_ids || parsed.content_ids || [],
          contents: parsed.custom_data?.contents || parsed.contents || [],
          content_type: parsed.custom_data?.content_type || parsed.content_type || 'product'
        };

        const hasUserMatch =
          user_data.em || user_data.ph ||
          (user_data.client_ip_address && user_data.client_user_agent);

        if (!hasUserMatch) {
          console.warn('⚠️ Skipping event: missing user match info');

          // 👉 Tot trimitem logul la Meta pentru debugging
          const testPayload = {
            data: [
              {
                event_name,
                event_time,
                user_data,
                custom_data,
                event_source_url,
                action_source
              }
            ],
            test_event_code: 'DEBUG' // for test traffic only
          };

          const testReq = https.request({
            hostname: 'graph.facebook.com',
            path: `/v17.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          }, testRes => {
            let testData = '';
            testRes.on('data', chunk => (testData += chunk));
            testRes.on('end', () => {
              console.log(`🧪 Meta debug (skipped): ${testRes.statusCode} - ${testData}`);
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end('Skipped: no user_data, sent to Meta debug');
            });
          });

          testReq.on('error', err => {
            console.error('❌ Meta debug error:', err.message);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Meta debug error');
          });

          testReq.write(JSON.stringify(testPayload));
          return testReq.end();
        }

        const payload = {
          data: [
            {
              event_name,
              event_time,
              user_data,
              custom_data,
              event_source_url,
              action_source
            }
          ]
        };

        const options = {
          hostname: 'graph.facebook.com',
          path: `/v17.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const fbReq = https.request(options, fbRes => {
          let fbData = '';
          fbRes.on('data', chunk => (fbData += chunk));
          fbRes.on('end', () => {
            console.log(`📬 Meta response: ${fbRes.statusCode} - ${fbData}`);
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Event sent to Meta');
          });
        });

        fbReq.on('error', err => {
          console.error('❌ Meta API error:', err.message);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Meta API request failed');
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
  console.log(`🚀 Server running on port ${PORT}`);
});
