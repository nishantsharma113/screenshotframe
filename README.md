# Shotframe — App Store & Google Play screenshot maker

React + TypeScript (Vite) frontend, Supabase backend (Auth, Postgres, Storage).
Screenshots are rendered and exported **in the browser** — no server code needed.

## 1. Run it locally

```bash
npm install
cp .env.example .env.local   # fill in after step 2 (optional for a first look)
npm run dev                  # http://localhost:5173
```

Without `.env.local` the app still runs: the project is saved in the browser
(localStorage), templates come from `src/lib/constants.ts`, and every feature is unlocked.

## 2. Connect Supabase

1. Create a project at <https://supabase.com>.
2. **SQL Editor → New query** → paste `supabase/migrations/0001_init.sql` → **Run**.
   This creates `profiles`, `projects`, `templates` (with 8 seed templates),
   the public `screenshots` storage bucket, and all Row Level Security policies.
   (With the Supabase CLI: `supabase link` then `supabase db push`.)
   Then run `0002_admin.sql` … `0007_billing.sql` the same way, in order.
   To check the security rules, paste `supabase/tests/rls_test.sql` into the SQL Editor
   and run it. It ends with **All RLS checks passed**, or stops with a `FAIL: …` message.
   The test creates two throwaway users and always cleans them up.
3. **Authentication → Providers → Email**: keep it enabled. The sign-in page offers
   email + password (sign in / create account) and a magic link as a fallback.
   With **Confirm email** on (the default), new accounts must click the link in
   their inbox before they can sign in; turn it off for faster local testing.
4. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:5173` (your real domain in production)
   - Redirect URLs: add `http://localhost:5173/**` and `https://YOUR-DOMAIN/**`
5. **Project Settings → API**: copy the Project URL and the `anon` public key into `.env.local`:

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
6. Restart `npm run dev`.

## 3. How it works

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/templates` | Template gallery (filters + search) → “Use” opens the editor with that template |
| `/editor/new` | Creates a project (cloud if signed in, browser if not) and redirects |
| `/editor/local` | The signed-out, browser-only project |
| `/editor/:id` | A cloud project (autosaves 0.8 s after each change) |
| `/signin` | Email + password sign-in and create account (`?mode=signup`), magic link fallback, `?next=/path` to return after sign-in |
| `/projects` | Signed-in user’s projects |

```
src/
  components/
    SlideView.tsx          one screenshot (used by canvas, landing, projects and export)
    editor/                TopBar, LeftPanel, Canvas, RightPanel, ExportDialog
  hooks/
    useAuth.tsx            session + plan from `profiles`
    useProject.ts          load / create / autosave a project
  lib/
    constants.ts           devices, export sizes, swatches, languages, default design
    export.tsx             off-screen render → html-to-image → JSZip download
    supabase.ts            client (null when env is missing)
    types.ts
  services/                projects, templates, storage (Supabase calls)
  store/editorReducer.ts   all editor state changes + undo/redo
supabase/migrations/       database schema, RLS, storage policies, seed templates
```

**Design data.** A project is one row with a `design` JSON column:
store, device, background, layout, angle, font, languages and the slides
(headline/subtitle per language + screenshot URL). See `src/lib/types.ts`.

**Landscape & feature graphic.** Each device has a **Landscape** toggle. Landscape slides are laid out
414 units *tall*, with the device on its side next to the text, and export at the swapped sizes
(e.g. 2868 × 1320). Google Play projects also get a 1024 × 500 **feature graphic**: one headline per
language, an optional app icon and the project background. It's exported as `<language>/feature-graphic.png`.

**Backgrounds.** A project background is a colour plus an optional 2-colour gradient (angle + two
colours) and an optional image. Any slide can override it (**Background → Slide N**). In panoramic mode,
the project gradient or image is one wide layer across all slides, so it flows from slide to slide; a
slide with its own background stands alone. Text turns dark or light based on the gradient's middle colour.
Background images are stored like screenshots and cleaned up the same way.

**Saved templates.** On the Standard plan, **Save as template** in the editor top bar stores the look of a
project (device, backgrounds, fonts, layout, slide text and positions) in `user_templates`. Screenshots,
the feature-graphic icon and per-slide background images aren't included. A project background image is
copied to `screenshots/<user_id>/templates/<template_id>/`, and copied again into each new project made
from the template, so deleting a project or a template never breaks another. Find them at
**/templates → My templates**.

**Store sizes.** Every App Store and Google Play size lives in one file,
`src/config/storeSizes.ts`: store, device group, name, portrait width × height, and whether it's
required. The editor's **Size** picker, the export dialog, the ZIP folders and the slide-count
warnings all read it.

| Store | Sizes | Rules |
|---|---|---|
| App Store | iPhone Dynamic Island medium (**required**), 6.9", 6.5", Face ID medium, 5.5", Duo outer/inner (required from Apr 2027), iPad 13" (required for iPad apps), iPad 11", app icon 1024² | 1–10 screenshots per size; JPG/PNG, no transparency |
| Google Play | Phone 1080 × 1920 (**required**, 2–8), 7" and 10" tablet (up to 8), feature graphic 1024 × 500, app icon 512² | each side 320–3840 px, ≤ 8 MB, JPG or 24-bit PNG |

Landscape swaps width and height. Picking a size also picks its device frame. Apple sizes are real
device screens, so the frame's screen takes the size's own shape; Google Play's 9:16 / 10:16 sizes
keep the device's shape.

**Export.** Every slide is laid out at 414 units on its short side and rendered at the **exact
pixel size** of each size you tick. Each image is flattened onto the slide's background and written
as a **24-bit PNG with no alpha channel** (or JPG). The export dialog warns when the slide count
breaks a store's min/max. App icons come from the icon uploaded for the feature graphic. The ZIP is
laid out per store, device and language, using the locale names fastlane expects:

```
ios/iphone-6.3/en-US/01.png            ios/iphone-6.9-1290x2796/en-US/01.png   (non-main size of a group)
ios/ipad-13/de-DE/01.png               ios/iphone-6.3-landscape/en-US/01.png
android/phone/en-US/01.png             android/feature-graphic/en-US/feature-graphic.png
ios/app-icon/icon-1024.png             android/app-icon/icon-512.png
```

Check a ZIP before uploading: `node scripts/check-export.mjs path/to/export.zip`. It verifies every
image's exact size (from `storeSizes.ts`), that there's no alpha channel, Google Play's 8 MB and
320–3840 px limits, and the screenshot counts.

Projects made before size presets keep their look: they're given the closest preset to the size they
rendered at. Old Google Play tablet projects (1440 × 2560) move to the 10" tablet size (1600 × 2560).
Fonts are self-hosted with `@fontsource` so they embed in exported images.

**Storage cleanup.** When a screenshot is replaced or removed, or its slide is deleted, the file is
deleted after the change autosaves. Files that an undo or redo step still uses are kept until you leave
the editor. Deleting a project on `/projects` deletes its whole `screenshots/<user_id>/<project_id>/`
folder. This needs `0003_rls_fixes.sql`.

**Custom fonts.** Standard and Extended users can choose **Font → Upload font…** (.ttf, .otf or .woff2, up to 2 MB).
Files go to the private `fonts` bucket at `fonts/<user_id>/…`, and each font gets a row in `user_fonts`. The
editor downloads a font through a one-hour signed URL and registers it with the FontFace API as `sf-<id>`.
Export inlines it into the PNG renderer, because `html-to-image` can't see fonts added that way. One uploaded
file is used for every weight, so headlines aren't faux-bolded. If a font can't be loaded, text falls back to Inter.

**Uploads.** Signed in: Supabase Storage at `screenshots/<user_id>/<project_id>/…`
(each user can only write in their own folder). Signed out: stored as data URLs
in the browser, which is limited to a few MB — the editor warns when it’s full.

## 4. Plans

`profiles.plan` is `basic`, `standard` or `extended`. 3D angles, adding
languages, uploading fonts, saving templates and auto-translate need `standard` or above (see `PLAN_FEATURES` in `constants.ts`).
Clients can’t change their own plan (no update policy). Plans are bought through Razorpay
(see **Billing** below). You can still set one by hand, for example for testing or a comped account:

```sql
update public.profiles set plan = 'standard' where email = 'you@example.com';
```

### Admin account (always on the top plan)

Run `supabase/migrations/0002_admin.sql` once (SQL Editor → paste → Run). Then:

1. Create the admin's login: sign up at `/signin?mode=signup`, or in the dashboard
   **Authentication → Users → Add user** (set a password and tick *Auto confirm*).
2. In the SQL Editor:

   ```sql
   select public.make_admin('admin@example.com');   -- is_admin = true, plan = 'extended'
   select public.remove_admin('admin@example.com'); -- back to a basic account
   ```
3. Sign out and back in (or refresh). The header shows **Admin · Pro**, and 3D angles and languages are unlocked.

Admins always get `extended`, even if their `plan` column says something else. These functions
can't be called from the browser; they are revoked for `anon` and `authenticated`.


## 5. Billing (Razorpay)

Standard and Extended are sold as monthly or yearly **Razorpay Subscriptions**.

- **Plans:** names, features and limits are in `supabase/functions/_shared/plans.ts`. The pricing page,
  the editor's feature gates, checkout and the Billing page all read it.
- **Prices:** read live from your Razorpay plans, so the pricing page always matches checkout.
- **Limits:** enforced by the database (`0007_billing.sql`). Basic is capped at 3 projects; the cap is
  checked per user under a lock, so parallel requests can't get past it. Saving templates and uploading
  fonts also need a paid plan.
- **Who sets the plan:** only server code. The `billing-webhook` function verifies Razorpay's signature;
  the `billing` function verifies the checkout signature and re-reads the subscription from Razorpay.
  The browser never sets a plan.

| Event | Result |
|---|---|
| Payment succeeds | Plan active; `plan_renews_at` = end of the paid period; invoice recorded |
| Renewal charged | `plan_renews_at` moves forward; invoice recorded |
| Upgrade (or monthly → yearly) | Applies immediately |
| Downgrade (or yearly → monthly) | Scheduled for the next renewal; the current plan continues until then |
| Payment fails | `past_due`: plan kept while Razorpay retries (until 3 days past the period end) |
| All retries fail | `halted`: back to Basic |
| Cancel | Access continues until `plan_renews_at`, then Basic |

`public.current_plan()` decides what a user has right now, so access ends on time even if a webhook is late.

**Set up, in Razorpay test mode first:**

1. Razorpay Dashboard (Test Mode) → **Settings → API Keys**: generate a test key (`rzp_test_…` and its
   secret). Put both in `.env.local` as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`; it's git-ignored.
2. Create the 4 plans (Standard ₹499/month or ₹4,999/year; Extended ₹999/month or ₹9,999/year):

   ```bash
   node scripts/create-razorpay-plans.mjs
   ```

   It prints the plan ids and the `supabase secrets set` command to run. Re-running is safe: existing
   plans are reused. To change prices, edit `PRICES` in the script and run it again (Razorpay plans can't
   be edited, so new prices create new plans; existing subscribers keep their old price).
3. Run `supabase/migrations/0007_billing.sql`, then deploy:

   ```bash
   supabase secrets set \
     RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=xxx RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string \
     RAZORPAY_PLAN_STANDARD_MONTHLY=plan_xxx RAZORPAY_PLAN_STANDARD_YEARLY=plan_xxx \
     RAZORPAY_PLAN_EXTENDED_MONTHLY=plan_xxx RAZORPAY_PLAN_EXTENDED_YEARLY=plan_xxx

   # Both verify callers themselves: billing checks the user's JWT (its price list is public);
   # billing-webhook checks Razorpay's HMAC signature.
   supabase functions deploy billing --no-verify-jwt
   supabase functions deploy billing-webhook --no-verify-jwt
   ```
4. **Settings → Webhooks → Add**:
   - **URL:** `https://YOUR-PROJECT-REF.supabase.co/functions/v1/billing-webhook`
   - **Secret:** the same `RAZORPAY_WEBHOOK_SECRET`
   - **Events:** `subscription.authenticated`, `.activated`, `.charged`, `.pending`, `.halted`,
     `.cancelled`, `.completed`, `.updated`, `.paused`, `.resumed`
5. Pay with Razorpay's test cards or UPI (see Razorpay's "Test card details" docs). To go live, repeat
   steps 1, 2 and 4 in Live Mode and set the live secrets.

Keys stay in Supabase secrets; the app only ever gets the public key id (`rzp_…`) from the function.

Tests: `deno test --allow-read supabase/functions/` covers signature checks, duplicate and out-of-order
webhooks, upgrade, downgrade, cancel, failed payment and renewal. `supabase/tests/rls_test.sql` covers
the project cap, billing-data RLS and `current_plan()` for every state.

## 5b. Auto-translate (Edge Function)

In the editor, after you add a language, the right panel shows **Auto-translate to …**. It calls the
`translate` Edge Function (`supabase/functions/translate/`). The function:

1. Checks the caller's token with Supabase Auth.
2. Checks that their plan is Standard or Extended (otherwise 403).
3. Reads the project with the caller's own token, so RLS applies.
4. Sends every slide's headline and subtitle in the main language (the project's first language) to
   DeepL or Google in **one** request.
5. Returns `{ slides: [{ id, headline, subtitle }], remaining }`.

The app saves pending edits first, then fills the language in one step, so one **Undo** reverts it.
Each user gets **50 calls per UTC day**, counted in `translate_usage` by `consume_translate_quota()`.
To change the limit, edit `daily_limit` in `0006_translate_usage.sql`. Arabic and Hebrew text is
shown right to left.

**Provider:** set `TRANSLATE_PROVIDER` to `deepl` (default) or `google`, and put that service's key
in `TRANSLATE_API_KEY`. DeepL free keys end in `:fx`, and the function picks the free endpoint for them.
DeepL doesn't offer Hindi, so with DeepL that language returns a clear error; use Google, or translate
Hindi by hand.

Deploy (needs the [Supabase CLI](https://supabase.com/docs/guides/cli); `npx supabase …` also works):

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF        # the xxxx in https://xxxx.supabase.co

# Usage table + limit function (or paste the file into the SQL Editor)
supabase db push                                    # or run supabase/migrations/0006_translate_usage.sql

# Secrets (stored in Supabase, never in the app)
supabase secrets set TRANSLATE_PROVIDER=deepl TRANSLATE_API_KEY=your-deepl-key
#   Google instead:  supabase secrets set TRANSLATE_PROVIDER=google TRANSLATE_API_KEY=your-google-key

# The function verifies the JWT itself (auth.getUser), so the gateway check is turned off.
# That also keeps it working with the new sb_publishable_… API keys.
supabase functions deploy translate --no-verify-jwt
```

Run it locally:

```bash
printf 'TRANSLATE_PROVIDER=deepl\nTRANSLATE_API_KEY=your-key\n' > supabase/functions/.env   # git-ignored
supabase start
supabase functions serve translate --no-verify-jwt --env-file supabase/functions/.env
```

Tests (no network or keys needed; they use a fake Supabase client and fake DeepL/Google):

```bash
deno test supabase/functions/translate/
```

## 6. Deploy

Vercel or Netlify: build command `npm run build`, output `dist`, and add the two
`VITE_SUPABASE_*` env vars. `vercel.json` already rewrites all routes to
`index.html` (for Netlify add `/* /index.html 200` to `public/_redirects`).
Add the production URL to Supabase’s redirect URLs.

## Not built yet (good next steps)

- **Free-form drag-and-drop** of text and devices (current layout is “text on top / below”).
- Deleting or renaming uploaded fonts (upload is built).
- **Public API** for CI/CD screenshot generation (would need server-side rendering, e.g. Playwright in a worker).
- A sweep for Storage files that no project references (files orphaned by a page refresh, or uploaded before automatic cleanup existed).
