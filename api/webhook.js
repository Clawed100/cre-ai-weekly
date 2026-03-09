const Stripe = require('stripe');
const { buffer } = require('micro');

// Tell Vercel not to parse the body — we need the raw bytes for Stripe signature
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  if (endpointSecret) {
    const sig = req.headers['stripe-signature'];
    try {
      const rawBody = await buffer(req);
      event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    // No secret configured — parse event directly (dev mode only)
    // Read and parse the body manually since bodyParser is disabled
    const rawBody = await buffer(req);
    event = JSON.parse(rawBody.toString());
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const customerEmail = session.customer_email || session.customer_details?.email;

        if (!customerEmail) break;

        // Find or create the Stripe customer with updated metadata
        const customers = await stripe.customers.list({ email: customerEmail, limit: 1 });

        if (customers.data.length > 0) {
          const customer = customers.data[0];
          await stripe.customers.update(customer.id, {
            metadata: {
              ...customer.metadata,
              plan: 'pro',
              source: 'cre-ai-weekly',
              upgraded_at: new Date().toISOString(),
            },
          });
        } else {
          // Customer subscribed via checkout without prior free signup
          await stripe.customers.create({
            email: customerEmail,
            metadata: {
              plan: 'pro',
              source: 'cre-ai-weekly',
              subscribed_at: new Date().toISOString(),
              upgraded_at: new Date().toISOString(),
            },
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer.metadata?.source === 'cre-ai-weekly') {
            await stripe.customers.update(customerId, {
              metadata: {
                ...customer.metadata,
                plan: 'free',
                downgraded_at: new Date().toISOString(),
              },
            });
          }
        } catch (e) {
          console.error('Failed to downgrade customer:', e.message);
        }
        break;
      }

      default:
        // Unhandled event type — that's fine
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook processing error:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};
