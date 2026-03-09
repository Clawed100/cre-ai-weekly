const Stripe = require('stripe');

// Rate limit email lookups to prevent enumeration
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 5;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
    rateLimit.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

module.exports = async function handler(req, res) {
  const siteUrl = process.env.SITE_URL || '';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', siteUrl || origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { sessionId, email } = req.body;

    // Mode 1: Verify a Stripe Checkout session (success page)
    if (sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status === 'paid') {
        const customerEmail = session.customer_email || session.customer_details?.email;
        return res.status(200).json({
          verified: true,
          plan: 'pro',
          email: customerEmail,
        });
      }

      return res.status(200).json({ verified: false, plan: 'free' });
    }

    // Mode 2: Look up a subscriber by email (sign-in)
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      const customers = await stripe.customers.list({ email, limit: 1 });

      if (customers.data.length === 0) {
        return res.status(200).json({ found: false });
      }

      const customer = customers.data[0];
      if (customer.metadata.source !== 'cre-ai-weekly') {
        return res.status(200).json({ found: false });
      }

      if (customer.metadata.unsubscribed === 'true') {
        return res.status(200).json({ found: true, plan: 'unsubscribed' });
      }

      return res.status(200).json({
        found: true,
        plan: customer.metadata.plan || 'free',
      });
    }

    return res.status(400).json({ error: 'Provide sessionId or email' });
  } catch (err) {
    console.error('Verify session error:', err.message);
    return res.status(500).json({ error: 'Verification failed' });
  }
};
