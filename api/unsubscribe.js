const Stripe = require('stripe');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  const siteUrl = process.env.SITE_URL || '';
  res.setHeader('Access-Control-Allow-Origin', siteUrl || '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, token } = req.query;

  if (!email || !token) {
    return res.status(400).json({ error: 'Missing email or token' });
  }

  // Verify HMAC token with timing-safe comparison
  const expectedToken = crypto
    .createHmac('sha256', process.env.ADMIN_PASSWORD)
    .update(email)
    .digest('hex');

  if (token.length !== expectedToken.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) {
    return res.status(403).json({ error: 'Invalid unsubscribe token' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Find the customer by email
    const customers = await stripe.customers.list({ email, limit: 1 });

    if (customers.data.length > 0) {
      const customer = customers.data[0];
      await stripe.customers.update(customer.id, {
        metadata: {
          ...customer.metadata,
          unsubscribed: 'true',
          unsubscribed_at: new Date().toISOString(),
        },
      });
    }

    // Redirect to confirmation page
    res.writeHead(302, { Location: `${siteUrl}/unsubscribe.html` });
    return res.end();
  } catch (err) {
    console.error('Unsubscribe error:', err.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
