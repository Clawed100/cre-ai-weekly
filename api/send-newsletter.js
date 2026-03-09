const Stripe = require('stripe');
const { Resend } = require('resend');
const crypto = require('crypto');

function verifyAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!token || !expected || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function generateUnsubToken(email, secret) {
  return crypto.createHmac('sha256', secret).update(email).digest('hex');
}

function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildEmailHtml(subject, content, email, unsubUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;">
<tr><td align="center" style="padding:20px 0;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">

<!-- Header -->
<tr><td style="background-color:#0a0a0b;padding:24px 32px;">
<h1 style="margin:0;font-size:22px;color:#22c55e;font-family:Arial,Helvetica,sans-serif;">CRE + AI Weekly</h1>
<p style="margin:4px 0 0;font-size:13px;color:#888;">by Jeff</p>
</td></tr>

<!-- Body -->
<tr><td style="padding:32px;font-size:16px;line-height:1.6;color:#333333;">
${content}
</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 32px;background-color:#fafafa;border-top:1px solid #eee;font-size:12px;color:#999;line-height:1.5;">
<p style="margin:0 0 8px;">You received this because you subscribed to CRE + AI Weekly.</p>
<p style="margin:0 0 8px;"><a href="${unsubUrl}" style="color:#666;">Unsubscribe</a></p>
<p style="margin:0;">${process.env.MAILING_ADDRESS || 'CRE + AI Weekly'}</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
  const siteUrl = process.env.SITE_URL || '';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', siteUrl || origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { subject, content, audience } = req.body;

  if (!subject || !content) {
    return res.status(400).json({ error: 'Subject and content are required' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);
  const nlSiteUrl = siteUrl || 'https://yourdomain.com';
  const fromEmail = process.env.FROM_EMAIL || 'jeff@yourdomain.com';
  const mailingAddress = process.env.MAILING_ADDRESS || 'CRE + AI Weekly';

  try {
    // Pull all subscribers from Stripe
    const subscribers = [];
    let hasMore = true;
    let startingAfter = undefined;

    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;

      const customers = await stripe.customers.list(params);

      for (const c of customers.data) {
        if (c.metadata.source !== 'cre-ai-weekly') continue;
        if (c.metadata.unsubscribed === 'true') continue;
        if (!c.email) continue;

        // Filter by audience
        if (audience === 'free' && c.metadata.plan !== 'free') continue;
        if (audience === 'pro' && c.metadata.plan !== 'pro') continue;

        subscribers.push({ email: c.email, name: c.name || '' });
      }

      hasMore = customers.has_more;
      if (customers.data.length > 0) {
        startingAfter = customers.data[customers.data.length - 1].id;
      }
    }

    if (subscribers.length === 0) {
      return res.status(200).json({ sent: 0, failed: 0, total: 0, message: 'No subscribers found' });
    }

    // Send in batches of 50
    const BATCH_SIZE = 50;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);

      const emails = batch.map((sub) => {
        const token = generateUnsubToken(sub.email, process.env.ADMIN_PASSWORD);
        const unsubUrl = `${nlSiteUrl}/api/unsubscribe?email=${encodeURIComponent(sub.email)}&token=${token}`;
        const html = buildEmailHtml(subject, content, sub.email, unsubUrl);
        const text = stripHtml(content) + `\n\n---\nUnsubscribe: ${unsubUrl}\n${mailingAddress}`;

        return {
          from: `Jeff from CRE + AI Weekly <${fromEmail}>`,
          to: [sub.email],
          subject,
          html,
          text,
          reply_to: fromEmail,
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        };
      });

      try {
        await resend.batch.send(emails);
        sent += batch.length;
      } catch (err) {
        console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, err.message);
        failed += batch.length;
      }

      // Delay between batches to avoid rate limits
      if (i + BATCH_SIZE < subscribers.length) {
        await sleep(1000);
      }
    }

    return res.status(200).json({ sent, failed, total: subscribers.length });
  } catch (err) {
    console.error('Send newsletter error:', err.message);
    return res.status(500).json({ error: 'Failed to send newsletter' });
  }
};
