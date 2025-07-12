// server.js
const express = require('express');
const fetch   = require('node-fetch');
const cors    = require('cors');

const app  = express();
const port = process.env.PORT || 8080;
const PIXEL_ID = process.env.FB_PIXEL_ID;
const ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/healthz', (_req, res) => {
  res.send('OK');
});

// Main collect endpoint
app.post(['/collect','/g/collect'], async (req, res) => {
  console.log('📥 Raw Body:', JSON.stringify(req.body));

  const p = req.body;
  const eventName = p.event_name || 'unknown';
  const eventTime = p.event_time || Math.floor(Date.now()/1000);
  const eventUrl  = p.event_source_url || '';
  const actionSrc = p.action_source    || 'website';

  // Build clean contents array
  const rawItems = p.custom_data?.contents || p.ecommerce?.add?.products || [];
  const contents = rawItems.map(item => ({
    id:         item.id   || item.item_id   || 'unknown',
    quantity:   item.quantity || 1,
    item_price: item.item_price || item.price || 0
  }));

  const contentIds = p.custom_data?.content_ids || contents.map(c => c.id);
  const valueSum = contents.reduce((sum, c) => sum + c.quantity * c.item_price, 0);
  const currency = p.custom_data?.currency || p.ecommerce?.currencyCode || 'EUR';

  const payload = {
    data: [{
      event_name: eventName,
      event_time: eventTime,
      event_source_url: eventUrl,
      action_source: actionSrc,
      user_data: {
        em:                   p.user_data?.em                || '',
        client_user_agent:    p.user_data?.client_user_agent || req.get('user-agent'),
        client_ip_address:    p.user_data?.client_ip_address || req.ip,
        fbp:                  p.user_data?.fbp               || '',
        fbc:                  p.user_data?.fbc               || ''
      },
      custom_data: {
        value:       p.custom_data?.value    ?? valueSum,
        currency,
        content_ids: contentIds,
        contents
      }
    }]
  };

  console.log('📦 Payload to Meta:', JSON.stringify(payload, null, 2));

  try {
    const fbRes = await fetch(
      `https://graph.facebook.com/v17.0/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );
    const text = await fbRes.text();
    console.log(`📬 Meta response [${fbRes.status}]:`, text);
    res.status(fbRes.status).send(text);
  } catch (err) {
    console.error('❌ Meta API error:', err);
    res.status(500).send('Meta API error');
  }
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).send('Not Found');
});

app.listen(port, () => {
  console.log(`🚀 Server listening on port ${port}`);
});
