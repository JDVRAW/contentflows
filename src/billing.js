// Stripe subscriptions for the paid storage plans.
// Needs STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for the webhook). Prices are created in Stripe
// automatically the first time someone picks a plan, under lookup keys like cf_pro_month, so nothing
// has to be set up by hand in the Stripe dashboard. If a price in plans.js changes, a new Stripe price
// takes over the lookup key; existing subscribers keep the price they signed up with.
const Stripe = require('stripe');
const { db } = require('./db');
const { PLANS, PAID, INTERVALS } = require('./plans');

const val = (k) => String(process.env[k] || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const KEY = val('STRIPE_SECRET_KEY');
const WEBHOOK_SECRET = val('STRIPE_WEBHOOK_SECRET');
const enabled = !!KEY;

// STRIPE_API_URL points the client at a local stand-in for tests.
const api = val('STRIPE_API_URL') ? new URL(val('STRIPE_API_URL')) : null;
const stripe = enabled ? Stripe(KEY, api ? { host: api.hostname, port: api.port, protocol: api.protocol.replace(':', '') } : {}) : null;

const lookupKey = (plan, interval) => `cf_${plan}_${interval}`;
const priceCache = new Map();

// The Stripe price for a plan and interval, created if it doesn't exist yet or no longer matches plans.js.
async function priceFor(plan, interval) {
  const key = lookupKey(plan, interval);
  if (priceCache.has(key)) return priceCache.get(key);
  const amount = PLANS[plan][interval];
  const keys = INTERVALS.map((i) => lookupKey(plan, i));
  const { data } = await stripe.prices.list({ lookup_keys: keys, active: true, limit: 10 });
  let price = data.find((p) => p.lookup_key === key && p.unit_amount === amount && p.recurring?.interval === interval);
  if (!price) {
    const sibling = data.find((p) => p.product);
    price = await stripe.prices.create({
      unit_amount: amount, currency: 'usd', recurring: { interval }, lookup_key: key, transfer_lookup_key: true,
      ...(sibling ? { product: typeof sibling.product === 'string' ? sibling.product : sibling.product.id }
        : { product_data: { name: `ContentFlows ${PLANS[plan].name}` } }),
      metadata: { plan },
    });
  }
  priceCache.set(key, price.id);
  return price.id;
}

async function customerFor(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const c = await stripe.customers.create({ email: user.email, name: user.studio || user.name, metadata: { user_id: String(user.id) } });
  db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(c.id, user.id);
  return c.id;
}

const LIVE = ['active', 'trialing', 'past_due'];
const hasLiveSubscription = (user) => !!user.stripe_subscription_id && LIVE.includes(user.plan_status);

// Copy a Stripe subscription onto the user it belongs to.
function syncSubscription(sub) {
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const user = db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customer)
    || (sub.metadata?.user_id && db.prepare('SELECT * FROM users WHERE id = ?').get(sub.metadata.user_id));
  if (!user) return null;
  // Ignore events for an older subscription once the user has moved to a newer one.
  if (user.stripe_subscription_id && user.stripe_subscription_id !== sub.id && hasLiveSubscription(user) && !LIVE.includes(sub.status)) return user.id;
  const item = sub.items?.data?.[0];
  const m = /^cf_(\w+)_(month|year)$/.exec(item?.price?.lookup_key || '');
  const plan = m && PAID.includes(m[1]) ? m[1] : PAID.includes(sub.metadata?.plan) ? sub.metadata.plan : null;
  const interval = m ? m[2] : item?.price?.recurring?.interval || null;
  const periodEnd = item?.current_period_end || sub.current_period_end || null;
  if (LIVE.includes(sub.status) && plan) {
    db.prepare(`UPDATE users SET plan = ?, plan_interval = ?, plan_status = ?, stripe_subscription_id = ?, stripe_customer_id = ?,
      plan_period_end = ?, plan_cancel_at_end = ? WHERE id = ?`)
      .run(plan, interval, sub.status, sub.id, customer, periodEnd, sub.cancel_at_period_end ? 1 : 0, user.id);
  } else if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
    db.prepare(`UPDATE users SET plan = 'free', plan_interval = NULL, plan_status = ?, stripe_subscription_id = NULL,
      plan_period_end = NULL, plan_cancel_at_end = 0 WHERE id = ?`).run(sub.status, user.id);
  }
  return user.id;
}

// Start a subscription (Stripe Checkout), or switch an existing one to another plan or interval.
// Resolves to a URL to send the browser to.
async function choosePlan(user, plan, interval, origin) {
  const price = await priceFor(plan, interval);
  if (hasLiveSubscription(user)) {
    const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
    const item = sub.items.data[0];
    const upgrade = PLANS[plan].limit > (PLANS[user.plan]?.limit || 0);
    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price }], cancel_at_period_end: false, metadata: { ...sub.metadata, plan },
      // Moving up charges the difference now; moving down credits it on the next bill.
      proration_behavior: upgrade ? 'always_invoice' : 'create_prorations',
    });
    syncSubscription(updated);
    return `${origin}/pricing?changed=${plan}`;
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', customer: await customerFor(user), client_reference_id: String(user.id),
    line_items: [{ price, quantity: 1 }], allow_promotion_codes: true,
    subscription_data: { metadata: { user_id: String(user.id), plan } },
    success_url: `${origin}/billing/done?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/pricing`,
  });
  return session.url;
}

// After Checkout, apply the plan right away instead of waiting for the webhook.
async function finishCheckout(user, sessionId) {
  const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
  const customer = typeof s.customer === 'string' ? s.customer : s.customer?.id;
  if (String(s.client_reference_id) !== String(user.id) && customer !== user.stripe_customer_id) return false;
  if (s.subscription && typeof s.subscription === 'object') syncSubscription(s.subscription);
  return true;
}

async function setCancelAtEnd(user, cancel) {
  if (!user.stripe_subscription_id) return;
  syncSubscription(await stripe.subscriptions.update(user.stripe_subscription_id, { cancel_at_period_end: cancel }));
}

async function portalUrl(user, origin) {
  const s = await stripe.billingPortal.sessions.create({ customer: await customerFor(user), return_url: `${origin}/pricing` });
  return s.url;
}

// Verify and apply a webhook event. Throws if the signature is wrong.
async function handleWebhook(rawBody, signature) {
  const event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  const o = event.data.object;
  if (event.type === 'checkout.session.completed' && o.mode === 'subscription' && o.subscription) {
    syncSubscription(await stripe.subscriptions.retrieve(typeof o.subscription === 'string' ? o.subscription : o.subscription.id));
  } else if (event.type.startsWith('customer.subscription.')) {
    syncSubscription(o);
  }
  return event.type;
}

module.exports = { enabled, webhookReady: enabled && !!WEBHOOK_SECRET, choosePlan, finishCheckout, setCancelAtEnd, portalUrl, handleWebhook, hasLiveSubscription };
