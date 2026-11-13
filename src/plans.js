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
// Only once that email is confirmed, so nobody can claim the role by signing up with an owner's address.
const isOwner = (user) => !!user && !!user.email_verified && OWNERS.has(String(user.email).toLowerCase());

const planOf = (user) => (isOwner(user) ? { id: 'owner', name: 'Owner', limit: Infinity } : PLANS[user?.plan] || PLANS.free);

// Pro and up (and owners) can put their own logo on deliveries; Free shows the studio name.
const canBrand = (user) => planOf(user).id !== 'free';

// What a client sees as the creator's brand: the studio name, plus logo URLs when the plan allows.
const brandOf = (user) => {
  const name = user.studio || user.name;
  if (!canBrand(user) || (!user.logo_dark && !user.logo_light)) return { name };
  const url = (f) => (f ? `/brand/${f}` : null);
  return { name, dark: url(user.logo_dark || user.logo_light), light: url(user.logo_light || user.logo_dark) };
};

module.exports = { PLANS, PAID, INTERVALS, GB, planOf, isOwner, canBrand, brandOf };
