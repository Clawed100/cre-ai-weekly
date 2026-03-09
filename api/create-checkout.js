const Stripe = require('stripe');

// Simple in-memory rate limit (per serverless instance)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 3; // 3 checkout attempts per minute per IP

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
  // CORS headers
  const siteUrl = process.env.SITE_URL || '';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', siteUrl || origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    let { email } = req.body;

    // Input sanitization
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Valid email required' });
    }
    email = email.trim().toLowerCase();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Validate STRIPE_PRICE_ID is configured
    if (!process.env.STRIPE_PRICE_ID) {
      console.error('STRIPE_PRICE_ID not configured');
      return res.status(500).json({ error: 'Checkout not available' });
    }

    // Determine base URL from request headers
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    // Create Stripe Checkout Session for Pro subscription with idempotency
    const idempotencyKey = `${email}-${Math.floor(Date.now() / 60000)}`; // Changes every minute
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        payment_method_types: ['card'],
        customer_email: email,
        line_items: [
          {
            price: process.env.STRIPE_PRICE_ID,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/#pricing`,
        metadata: {
          plan: 'pro',
          source: 'cre-ai-weekly',
          created_at: new Date().toISOString(),
        },
      },
      {
        idempotencyKey,
      }
    );

    return res.status(200).json({
      url: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('Checkout error:', err.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
