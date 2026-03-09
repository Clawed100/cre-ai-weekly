#!/bin/bash
set -e

echo ""
echo "========================================"
echo "  CRE + AI Weekly — Launch Script"
echo "========================================"
echo ""

# ── 1. INSTALL DEPENDENCIES ──
echo "[1/7] Installing dependencies..."
npm install
echo "✓ package-lock.json generated"
echo ""

# ── 2. STRIPE SETUP ──
echo "[2/7] Setting up Stripe..."
echo ""
echo "  You need these from https://dashboard.stripe.com:"
echo ""
echo "  a) Go to Developers > API Keys"
echo "     Copy your SECRET key (sk_live_... or sk_test_...)"
echo ""
echo "  b) Go to Products > + Add product"
echo "     Name: 'CRE + AI Weekly Pro'"
echo "     Price: \$12.00 / month (recurring)"
echo "     Copy the price ID (price_...)"
echo ""
echo "  c) Go to Developers > Webhooks > + Add endpoint"
echo "     URL: https://YOUR_DOMAIN/api/webhook"
echo "     Events: checkout.session.completed, customer.subscription.deleted"
echo "     Copy the signing secret (whsec_...)"
echo ""
read -p "  Stripe Secret Key: " STRIPE_SECRET_KEY
read -p "  Stripe Price ID: " STRIPE_PRICE_ID
read -p "  Stripe Webhook Secret: " STRIPE_WEBHOOK_SECRET
echo ""

# ── 3. RESEND SETUP ──
echo "[3/7] Setting up Resend..."
echo ""
echo "  Go to https://resend.com/api-keys"
echo "  Also verify your domain at https://resend.com/domains"
echo ""
read -p "  Resend API Key: " RESEND_API_KEY
read -p "  From Email (e.g. jeff@yourdomain.com): " FROM_EMAIL
echo ""

# ── 4. SITE CONFIG ──
echo "[4/7] Site configuration..."
read -p "  Admin Password (strong random string): " ADMIN_PASSWORD
read -p "  Mailing Address (for CAN-SPAM): " MAILING_ADDRESS
echo ""

# ── 5. VERCEL DEPLOY ──
echo "[5/7] Deploying to Vercel..."
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "  Installing Vercel CLI..."
    npm install -g vercel
fi

# Deploy and capture the URL
echo "  Running vercel deploy..."
DEPLOY_URL=$(vercel --yes 2>&1 | grep -oE 'https://[^ ]+\.vercel\.app' | head -1)

if [ -z "$DEPLOY_URL" ]; then
    echo "  ⚠ Could not auto-detect deploy URL."
    read -p "  Enter your Vercel URL: " DEPLOY_URL
fi

SITE_URL="$DEPLOY_URL"
echo "  Deploy URL: $SITE_URL"
echo ""

# ── 6. SET ENV VARS ──
echo "[6/7] Setting environment variables on Vercel..."
echo "$STRIPE_SECRET_KEY" | vercel env add STRIPE_SECRET_KEY production --yes 2>/dev/null || true
echo "$STRIPE_PRICE_ID" | vercel env add STRIPE_PRICE_ID production --yes 2>/dev/null || true
echo "$STRIPE_WEBHOOK_SECRET" | vercel env add STRIPE_WEBHOOK_SECRET production --yes 2>/dev/null || true
echo "$RESEND_API_KEY" | vercel env add RESEND_API_KEY production --yes 2>/dev/null || true
echo "$FROM_EMAIL" | vercel env add FROM_EMAIL production --yes 2>/dev/null || true
echo "$ADMIN_PASSWORD" | vercel env add ADMIN_PASSWORD production --yes 2>/dev/null || true
echo "$SITE_URL" | vercel env add SITE_URL production --yes 2>/dev/null || true
echo "$MAILING_ADDRESS" | vercel env add MAILING_ADDRESS production --yes 2>/dev/null || true
echo "✓ Environment variables set"
echo ""

# ── 7. REDEPLOY WITH ENV VARS ──
echo "[7/7] Redeploying with environment variables..."
vercel --prod --yes
echo ""

echo "========================================"
echo "  🚀 LAUNCHED!"
echo "========================================"
echo ""
echo "  Site: $SITE_URL"
echo "  Admin: $SITE_URL/admin.html"
echo ""
echo "  ── NEXT STEPS ──"
echo "  1. Update Stripe webhook URL to: $SITE_URL/api/webhook"
echo "  2. Test subscribe at $SITE_URL"
echo "  3. Test admin at $SITE_URL/admin.html"
echo "  4. Send your first newsletter!"
echo ""
echo "  ── ONCE YOU HAVE A CUSTOM DOMAIN ──"
echo "  1. Add domain in Vercel project settings"
echo "  2. Update SITE_URL env var to your domain"
echo "  3. Update Stripe webhook URL"
echo "  4. Find-and-replace 'yourdomain.com' in index.html"
echo "     and robots.txt with your real domain"
echo ""
