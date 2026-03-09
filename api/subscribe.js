const Stripe = require('stripe');
const { Resend } = require('resend');

// Simple in-memory rate limit (per serverless instance)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 5; // 5 requests per minute per IP

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

  // Rate limiting
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    const { email } = req.body;

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email) || email.length > 254) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Check if customer already exists with this source
    const existing = await stripe.customers.list({ email, limit: 1 });

    if (existing.data.length > 0 && existing.data[0].metadata?.source === 'cre-ai-weekly') {
      // Already subscribed — re-subscribe if they had unsubscribed
      const customer = existing.data[0];
      if (customer.metadata.unsubscribed === 'true') {
        await stripe.customers.update(customer.id, {
          metadata: {
            ...customer.metadata,
            unsubscribed: 'false',
            resubscribed_at: new Date().toISOString(),
          },
        });
      }
      return res.status(200).json({ success: true, message: 'Subscribed' });
    }

    // Create new Stripe customer for free subscriber
    await stripe.customers.create({
      email,
      metadata: {
        plan: 'free',
        source: 'cre-ai-weekly',
        subscribed_at: new Date().toISOString(),
      },
    });

    // Send welcome email (fire-and-forget — don't block the response)
    if (process.env.RESEND_API_KEY && process.env.FROM_EMAIL) {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const siteUrl = process.env.SITE_URL || 'https://yourdomain.com';
      resend.emails.send({
        from: `Jeff from CRE + AI Weekly <${process.env.FROM_EMAIL}>`,
        to: [email],
        subject: 'Welcome to CRE + AI Weekly',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
<tr><td style="background:#0a0a0b;padding:24px 32px;">
<h1 style="margin:0;font-size:22px;color:#22c55e;">CRE + AI Weekly</h1>
<p style="margin:4px 0 0;font-size:13px;color:#888;">by Jeff</p>
</td></tr>
<tr><td style="padding:32px;font-size:16px;line-height:1.6;color:#333;">
<h2 style="margin:0 0 16px;font-size:20px;color:#111;">Welcome aboard.</h2>
<p>You're now getting the weekly CRE + AI newsletter — real tools, real numbers, no hype.</p>
<p>Every week you'll get:</p>
<ul style="padding-left:20px;">
<li>The latest AI tools changing commercial real estate</li>
<li>Data-backed market insights</li>
<li>Practical implementation tips you can use immediately</li>
</ul>
<p>Your first issue arrives this week.</p>
<p style="margin-top:24px;">
<a href="${siteUrl}" style="display:inline-block;padding:12px 24px;background:#22c55e;color:#000;text-decoration:none;border-radius:6px;font-weight:bold;">Read the latest issue</a>
</p>
<p style="margin-top:24px;color:#666;">— Jeff</p>
</td></tr>
<tr><td style="padding:24px 32px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#999;">
<p style="margin:0;">${process.env.MAILING_ADDRESS || 'CRE + AI Weekly'}</p>
</td></tr>
</table></td></tr></table></body></html>`,
        reply_to: process.env.FROM_EMAIL,
      }).catch(err => console.error('Welcome email failed:', err.message));
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Subscribe error:', err.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};
