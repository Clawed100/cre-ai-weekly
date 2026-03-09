const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  // Allow GET requests only
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  const checks = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {},
  };

  try {
    // Check Stripe connectivity
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      await stripe.customers.list({ limit: 1 });
      checks.checks.stripe = { status: 'ok', responseTime: `${Date.now() - startTime}ms` };
    } catch (err) {
      checks.checks.stripe = { status: 'error', error: err.message };
    }

    // Check environment variables
    checks.checks.env = {
      status: process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID && process.env.RESEND_API_KEY ? 'ok' : 'error',
      required: [
        'STRIPE_SECRET_KEY',
        'STRIPE_PRICE_ID',
        'RESEND_API_KEY',
        'ADMIN_PASSWORD',
        'FROM_EMAIL',
        'SITE_URL',
        'STRIPE_WEBHOOK_SECRET',
      ],
      configured: [
        process.env.STRIPE_SECRET_KEY ? 'STRIPE_SECRET_KEY' : null,
        process.env.STRIPE_PRICE_ID ? 'STRIPE_PRICE_ID' : null,
        process.env.RESEND_API_KEY ? 'RESEND_API_KEY' : null,
        process.env.ADMIN_PASSWORD ? 'ADMIN_PASSWORD' : null,
        process.env.FROM_EMAIL ? 'FROM_EMAIL' : null,
        process.env.SITE_URL ? 'SITE_URL' : null,
        process.env.STRIPE_WEBHOOK_SECRET ? 'STRIPE_WEBHOOK_SECRET' : null,
      ].filter(Boolean),
    };

    const allChecksPass = Object.values(checks.checks).every(c => c.status === 'ok');
    const statusCode = allChecksPass ? 200 : 503;

    res.setHeader('Content-Type', 'application/json');
    return res.status(statusCode).json({
      status: allChecksPass ? 'healthy' : 'degraded',
      ...checks,
    });
  } catch (err) {
    console.error('Health check error:', err.message);
    return res.status(500).json({
      status: 'unhealthy',
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
};
