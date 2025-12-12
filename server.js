function forwardToMeta(ctx) {
  return new Promise((resolve, reject) => {
    const { events, normEventName, num, realIp, reqUA } = ctx;

    // ✅ Doar aceste evenimente au voie să aibă value/currency/contents
    const COMMERCE_EVENTS = new Set([
      'ViewContent',
      'AddToCart',
      'InitiateCheckout',
      'BeginCheckout',
      'Purchase'
    ]);

    const metaEvents = events.map(p => {
      const evName = normEventName(p.event_name || 'CustomEvent');

      const contentsSrc =
        p.custom_data?.contents || p.ecommerce?.add?.products || [];
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

      // ✅ Construim custom_data diferit în funcție de tipul evenimentului
      let custom_data;

      if (COMMERCE_EVENTS.has(evName)) {
        const value =
          p.custom_data?.value != null
            ? num(p.custom_data.value)
            : contents.reduce(
                (s, c) => s + Number(c.quantity) * num(c.item_price),
                0
              );

        const currency =
          p.custom_data?.currency || p.ecommerce?.currencyCode || 'EUR';

        const content_ids = Array.isArray(p.custom_data?.content_ids)
          ? p.custom_data.content_ids
          : contents.map(c => c.id);

        custom_data = {
          value,
          currency,
          content_type: p.custom_data?.content_type || 'product',
          content_ids,
          contents
        };
      } else {
        // ✅ Non-commerce (ex: engaged_homepage): păstrăm doar date non-monetare
        custom_data = { ...(p.custom_data || {}) };

        delete custom_data.value;
        delete custom_data.currency;
        delete custom_data.contents;
        delete custom_data.content_ids;
        delete custom_data.content_type;
      }

      return {
        event_name: evName,
        event_time: Number(p.event_time || Math.floor(Date.now() / 1000)),
        event_source_url: p.event_source_url || '',
        action_source: p.action_source || 'website',
        event_id: p.event_id || undefined,
        user_data,
        custom_data
      };
    });

    const metaBody = {
      data: metaEvents,
      access_token: FB_ACCESS_TOKEN,
      partner_agent: 'storosso-gtm-railway-ss'
    };
    if (META_TEST_EVENT_CODE) {
      metaBody.test_event_code = META_TEST_EVENT_CODE;
    }

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
      fbRes.on('data', d => { fbData += d; });
      fbRes.on('end', () => {
        console.log('📬 Meta statusCode:', fbRes.statusCode);
        console.log('📋 Meta headers:', fbRes.headers);
        console.log('🟪 Meta response body:', fbData);
        resolve({
          platform: 'meta',
          statusCode: fbRes.statusCode,
          body: fbData
        });
      });
    });

    fbReq.on('timeout', () => {
      console.error('❌ Meta request timeout');
      fbReq.destroy(new Error('timeout'));
    });

    fbReq.on('error', err => {
      console.error('❌ Meta request error:', err);
      reject(err);
    });

    fbReq.write(JSON.stringify(metaBody));
    fbReq.end();
  });
}
