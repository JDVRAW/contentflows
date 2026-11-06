// Storage plans. The limit is the total size of the files a creator keeps on ContentFlows;
// deleting a file or a delivery frees space. Prices are in cents (USD); yearly = 10 months.
const GB = 1024 ** 3;

const PLANS = {
  free: { id: 'free', name: 'Free', limit: 10 * GB, month: 0, year: 0, line: 'For your first deliveries' },
  pro: { id: 'pro', name: 'Pro', limit: 250 * GB, month: 1200, year: 12000, line: 'For working photographers and editors' },
  studio: { id: 'studio', name: 'Studio', limit: 1024 * GB, month: 2900, year: 29000, line: 'For studios delivering film every week' },
};
const PAID = ['pro', 'studio'];
const INTERVALS = ['month', 'year'];

// Accounts listed in OWNER_EMAILS (comma separated) have no storage limit: the people who run the site.
const OWNERS = new Set(String(process.env.OWNER_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
const isOwner = (user) => !!user && OWNERS.has(String(user.email).toLowerCase());

const planOf = (user) => (isOwner(user) ? { id: 'owner', name: 'Owner', limit: Infinity } : PLANS[user?.plan] || PLANS.free);

module.exports = { PLANS, PAID, INTERVALS, GB, planOf, isOwner };
