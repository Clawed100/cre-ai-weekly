const crypto = require('crypto');

function verifyAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!token || !expected || token.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
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

module.exports = async function handler(req, res) {
  const siteUrl = process.env.SITE_URL || '';
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', siteUrl || origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!verifyAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { subject, content } = req.body;

  if (!subject || !content) {
    return res.status(400).json({ error: 'Subject and content are required' });
  }

  // Content length validation
  const MAX_CONTENT_LENGTH = 50000;
  if (content.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH} characters` });
  }

  // Basic HTML sanitization for XSS prevention in preview
  const hasDangerousTags = /<script|<iframe|javascript:|on\w+\s*=|eval\(/i.test(content);
  if (hasDangerousTags) {
    return res.status(400).json({ error: 'Content contains potentially unsafe HTML' });
  }

  const previewSiteUrl = process.env.SITE_URL || 'https://yourdomain.com';
  const demoEmail = 'subscriber@example.com';
  const token = crypto.createHmac('sha256', process.env.ADMIN_PASSWORD).update(demoEmail).digest('hex');
  const unsubUrl = `${previewSiteUrl}/api/unsubscribe?email=${encodeURIComponent(demoEmail)}&token=${token}`;

  const html = buildEmailHtml(subject, content, demoEmail, unsubUrl);

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(html);
};
