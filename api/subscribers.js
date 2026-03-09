const Stripe = require('stripe');
const crypto = require('crypto');

// Cache stats (valid for 60 seconds)
const statsCache = {
  data: null,
  expiry: 0,
};

function verifyAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!token || !expected || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  const siteUrl = process.env.SITE_URL || '';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', siteUrl || origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Check cache first (valid for 60 seconds)
    const now = Date.now();
    if (statsCache.data && now < statsCache.expiry) {
      res.setHeader('X-Cache', 'hit');
      res.setHeader('X-Last-Updated', new Date(statsCache.timestamp).toISOString());
      return res.status(200).json(statsCache.data);
    }

    let total = 0;
    let free = 0;
    let pro = 0;
    let unsubscribed = 0;
    let hasMore = true;
    let startingAfter = undefined;

    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;

      const customers = await stripe.customers.list(params);

      for (const c of customers.data) {
        if (c.metadata.source !== 'cre-ai-weekly') continue;

        total++;

        if (c.metadata.unsubscribed === 'true') {
          unsubscribed++;
          continue;
        }

        if (c.metadata.plan === 'pro') pro++;
        else free++;
      }

      hasMore = customers.has_more;
      if (customers.data.length > 0) {
        startingAfter = customers.data[customers.data.length - 1].id;
      }
    }

    const result = { total, free, pro, unsubscribed, active: free + pro };

    // Cache the result
    statsCache.data = result;
    statsCache.expiry = now + 60 * 1000; // 60 second cache
    statsCache.timestamp = now;

    res.setHeader('X-Cache', 'miss');
    res.setHeader('X-Last-Updated', new Date(now).toISOString());
    return res.status(200).json(result);
  } catch (err) {
    console.error('Subscribers error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
};
