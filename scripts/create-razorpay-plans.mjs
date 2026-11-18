#!/usr/bin/env node
// Creates the 4 Razorpay subscription plans Shotframe sells and prints the secrets to set.
//
//   node scripts/create-razorpay-plans.mjs          # test mode (needs rzp_test_ keys)
//   node scripts/create-razorpay-plans.mjs --live   # live mode (rzp_live_ keys), after testing
//
// Keys are read from the environment or .env.local (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) and are
// never printed. Safe to re-run: a plan that already exists (same plan, interval and amount) is reused.
// To change prices later, edit PRICES, re-run, and set the new plan ids (Razorpay plans can't be edited;
// existing subscribers stay on their old plan).
import fs from 'node:fs';

/** Amounts in paise (₹1 = 100). Yearly ≈ 10 × monthly (2 months free). */
const PRICES = {
  standard: { monthly: 49900, yearly: 499900 },
  extended: { monthly: 99900, yearly: 999900 },
};
const CURRENCY = 'INR';
const NAMES = { standard: 'Shotframe Standard', extended: 'Shotframe Extended' };

function readEnv() {
  const env = { ...process.env };
  if (fs.existsSync('.env.local')) {
    for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = readEnv();
const live = process.argv.includes('--live');
const keyId = env.RAZORPAY_KEY_ID ?? '';
const keySecret = env.RAZORPAY_KEY_SECRET ?? '';
if (!keyId || !keySecret) {
  console.error('Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.local (Razorpay Dashboard → Settings → API Keys).');
  process.exit(1);
}
const mode = keyId.startsWith('rzp_live_') ? 'live' : keyId.startsWith('rzp_test_') ? 'test' : 'unknown';
if (mode === 'unknown') {
  console.error('RAZORPAY_KEY_ID should start with rzp_test_ or rzp_live_.');
  process.exit(1);
}
if (mode === 'live' && !live) {
  console.error('These are LIVE keys. Test first with rzp_test_ keys, or pass --live on purpose.');
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
async function rz(method, path, body) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${method} ${path}: ${res.status} ${data?.error?.description ?? ''}`);
  return data;
}

// Existing plans (to reuse instead of duplicating on a re-run)
const existing = [];
for (let skip = 0; ; skip += 100) {
  const page = await rz('GET', `/plans?count=100&skip=${skip}`);
  existing.push(...(page.items ?? []));
  if (!page.items || page.items.length < 100) break;
}

console.log(`Razorpay ${mode} mode\n`);
const secrets = [];
for (const plan of Object.keys(PRICES)) {
  for (const interval of ['monthly', 'yearly']) {
    const amount = PRICES[plan][interval];
    const found = existing.find(
      (p) => p.notes?.shotframe_plan === plan && p.notes?.interval === interval && p.item?.amount === amount && p.item?.currency === CURRENCY,
    );
    const p =
      found ??
      (await rz('POST', '/plans', {
        period: interval,
        interval: 1,
        item: { name: `${NAMES[plan]} (${interval})`, amount, currency: CURRENCY, description: `${NAMES[plan]}, billed ${interval}` },
        notes: { shotframe_plan: plan, interval },
      }));
    const rupees = (amount / 100).toLocaleString('en-IN');
    console.log(`${found ? 'exists ' : 'created'}  ${plan.padEnd(8)} ${interval.padEnd(7)} ₹${rupees.padStart(6)}  ${p.id}`);
    secrets.push(`RAZORPAY_PLAN_${plan.toUpperCase()}_${interval.toUpperCase()}=${p.id}`);
  }
}

console.log(`\nSet these Supabase secrets (plus your keys and a webhook secret):\n`);
console.log(`supabase secrets set \\\n  ${secrets.join(' \\\n  ')}`);
console.log(`\nsupabase secrets set RAZORPAY_KEY_ID=${keyId} RAZORPAY_KEY_SECRET=<your key secret> RAZORPAY_WEBHOOK_SECRET=<a long random string>`);
