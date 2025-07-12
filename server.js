// server.js
const http  = require('http')
const url   = require('url')
const https = require('https')

const PORT            = Number(process.env.PORT) || 8080
const FB_PIXEL_ID     = process.env.FB_PIXEL_ID
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN

const server = http.createServer((req, res) => {
  const { pathname } = url.parse(req.url, true)

  // CORS & preflight
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // Health check
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('OK')
  }

  // Main webhook
  if (pathname === '/collect' || pathname === '/g/collect') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      return res.end('Method Not Allowed')
    }

    // gather body
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', () => {
      // parse JSON
      let p
      try {
        p = JSON.parse(body || '{}')
      } catch {
        res.writeHead(400, { 'Content-Type':'text/plain' })
        return res.end('Invalid JSON')
      }

      // normalize
      const eventName = p.event_name       || 'unknown'
      const eventTime = p.event_time       || Math.floor(Date.now()/1000)
      const eventUrl  = p.event_source_url || ''
      const actionSrc = p.action_source    || 'website'

      // build contents
      const rawItems = p.custom_data?.contents || p.ecommerce?.add?.products || []
      const contents = rawItems.map(item => ({
        id:         item.id         || item.item_id   || 'unknown',
        quantity:   item.quantity   || 1,
        item_price: item.item_price || item.price     || 0
      }))
      const contentIds = p.custom_data?.content_ids || contents.map(c => c.id)
      const totalValue = contents.reduce((sum,c) => sum + c.quantity * c.item_price, 0)
      const currency   = p.custom_data?.currency || p.ecommerce?.currencyCode || 'EUR'

      // assemble payload
      const payload = {
        data: [{
          event_name:        eventName,
          event_time:        eventTime,
          event_source_url:  eventUrl,
          action_source:     actionSrc,
          user_data: {
            em:                 p.user_data?.em                || '',
            client_ip_address:  p.user_data?.client_ip_address || req.socket.remoteAddress || '',
            client_user_agent:  p.user_data?.client_user_agent || req.headers['user-agent']    || '',
            fbp:                p.user_data?.fbp               || '',
            fbc:                p.user_data?.fbc               || ''
          },
          custom_data: {
            value:       p.custom_data?.value    ?? totalValue,
            currency,
            content_ids: contentIds,
            contents
          }
        }]
      }

      // send to Meta CAPI
      const options = {
        hostname: 'graph.facebook.com',
        path:     `/v17.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
        method:   'POST',
        headers:  { 'Content-Type':'application/json' }
      }
      const fbReq = https.request(options, fbRes => {
        let fbData = ''
        fbRes.on('data', d => fbData += d)
        fbRes.on('end', () => {
          res.writeHead(fbRes.statusCode, { 'Content-Type':'application/json' })
          res.end(fbData)
        })
      })
      fbReq.on('error', () => {
        res.writeHead(502, { 'Content-Type':'text/plain' })
        res.end('Meta API error')
      })
      fbReq.write(JSON.stringify(payload))
      fbReq.end()
    })

    return
  }

  // otherwise 404
  res.writeHead(404, { 'Content-Type':'text/plain' })
  res.end('Not Found')
})

server.listen(PORT, () => {
  console.log(`Listening on ${PORT}`)
})
