# Shotframe — manual QA checklist

How to use: run `npm run dev`, open http://localhost:5173, and work through each section.
Tick a box when the **Expect** line holds. Sections marked *(Supabase)* need `.env.local` filled in;
the rest also work without it.

Tip for "slow network" checks: Chrome DevTools → Network → throttling **Slow 4G** or **Offline**.

Each bug is tagged **Fixed** (fixed in this pass, so retest it) or **Open** (known and still to do).
Every Fixed item has a matching check marked "(regression)".

---

## 0. Setup

- [ ] `npm install` then `npm run dev` start with no errors in the terminal.
- [ ] `npm run typecheck` passes.
- [ ] Without `.env.local`: header shows no "Sign in" button and `/signin` explains Supabase is needed.
- [ ] With `.env.local`: header shows "Sign in".

---

## 1. Landing → editor (signed out)

- [ ] `/` loads; hero shows 5 example screenshots.
- [ ] "Start designing", "Open editor", "Start free", "Choose Standard" all open `/editor/local`.
- [ ] First visit: editor opens with 5 sample slides; status reads **Saved in this browser** after a change.
- [ ] Refresh `/editor/local` → same project, same edits.
- [ ] (Supabase) Banner says the project is only in this browser, with a "Sign in or create an account" link.
- [ ] **(regression)** Edit something, then visit `/editor` or `/editor/new` by URL → you land on `/editor/local` **with your edits kept**.
  *Fixed: this used to silently replace the browser project with a blank one.*

## 2. Sign in / create account *(Supabase)*

Create account:
- [ ] `/signin` → **Create account** tab. Email, Password and Confirm password fields show.
- [ ] Password shorter than 6 characters → "Use a password with at least 6 characters." No request is sent.
- [ ] Passwords that don't match → "The two passwords don't match."
- [ ] Valid sign-up with **Confirm email** on → "We sent a confirmation link to …". The link opens the app signed in.
- [ ] Valid sign-up with **Confirm email** off → goes straight to **My projects**.
- [ ] Sign up again with the same email → "An account with this email already exists. Sign in instead."
- [ ] `/signin?mode=signup` opens on the Create account tab.

Sign in:
- [ ] Correct email + password → **My projects**.
- [ ] Wrong password → "Wrong email or password." The form stays filled.
- [ ] Account not confirmed yet → "Confirm your email first …".
- [ ] Press Enter and click **Sign in** quickly → only one request (button shows "Signing in…" and is disabled).
- [ ] Offline → "Can't reach the server …".
- [ ] "Forgot your password? Email me a sign-in link" → magic-link form; "Use email and password instead" switches back.
- [ ] Magic link: "Check … for a sign-in link"; the emailed link signs you in.
- [ ] Visiting `/signin` while signed in redirects to My projects.
- [ ] **(regression)** Signed out, open a cloud project URL `/editor/<id>` → **Sign in** → after signing in you return to that project, not My projects.
- [ ] `/signin?next=https://evil.example` → after sign-in you go to My projects (outside links are ignored).
- [ ] Sign out (header) → header shows "Sign in" again; `/projects` redirects to `/signin`.

**Open:** there's no "set a new password" page. Users who forget their password use the magic link.

## 3. New project *(Supabase, signed in)*

- [ ] My projects → **New project** → URL changes from `/editor/new` to `/editor/<uuid>`. Exactly **one** new row appears in My projects (StrictMode must not create two).
- [ ] Refresh the editor → same project loads.
- [ ] Offline, click New project → error screen with **My projects** and **Home** buttons (not "Sign in"). Back online → New project works (no stale failed state).
- [ ] Open `/editor/<random-uuid>` → "Project not found …" with a **My projects** button.

## 4. Template → editor

- [ ] `/templates` lists 8 templates; filters, search and **Clear filters** work; count updates.
- [ ] Signed out with an existing browser project, click **Use** → confirm dialog. **Cancel** keeps the old project. **OK** opens the editor with the template's colour, font and layout.
- [ ] Signed in, click **Use** → new cloud project in that template's style.
- [ ] Google Play-only template (e.g. Citrus Pop) → editor opens on **Google Play** with the Pixel device.
- [ ] **(regression)** Click **Use** on template A, press Back immediately, then **Use** on template B → the editor shows **B**, not A.
- [ ] `/editor/new?template=does-not-exist` → editor opens with the default design (no crash).

**Open:** if you click **Use** in the first instant after page load, signed-in users may see the "replaces the project in this browser" confirm.
**Open:** a template row in Supabase with `angle: left/right` gives Basic users a 3D angle.

## 5. Upload screenshots

- [ ] Click the drop zone → file picker → choose 3 PNGs → slides 1-3 (from the selected slide) show them.
- [ ] Drag files onto the drop zone → same result.
- [ ] Drag one file onto slide 4 in the canvas → only slide 4 changes, and it becomes selected.
- [ ] A `.gif`/`.pdf` or a file over 10 MB → toast names the file and why. Valid files in the same batch still upload.
- [ ] Choose the same file twice in a row → it uploads both times.
- [ ] While "Uploading…" shows, the drop zone is disabled.
- [ ] **(regression)** Drop a file on the dark canvas background, or on the drop zone while it's uploading → the browser does **not** open the image in the tab.
- [ ] **(regression)** Select slide 8 and upload 5 files → slides 8-10 fill. The toast says 2 were skipped (max 10 slides), and only 3 files are uploaded.
- [ ] **(regression)** (Supabase) Throttle to Offline mid-upload of several files → files that finished stay on their slides, and the toast says "N of M uploads failed".
- [ ] Signed out: upload several large PNGs until "Browser storage is full …" appears. Status reads **Not saved**.
- [ ] **(regression)** After that, remove a screenshot (smaller project) → status returns to **Saved in this browser** and the error toast goes away.
- [ ] "Remove screenshot from this slide" clears only the selected slide.

Storage cleanup *(Supabase, signed in, after `0003_rls_fixes.sql`)*. Keep the dashboard open at
**Storage → screenshots → `<your user id>/<project id>/`** and refresh it between steps.
- [ ] Upload 2 screenshots → 2 files appear in the folder.
- [ ] **Replace** slide 1's screenshot → after **Saved**, the folder still has the old file (undo can bring it back).
- [ ] Press Ctrl+Z → the old screenshot is back on slide 1 and loads (not a broken image).
- [ ] Ctrl+Shift+Z, then click the logo to leave the editor → the replaced file is **deleted**; the current one stays.
- [ ] **Remove screenshot from this slide**, wait for **Saved**, leave the editor → that file is deleted.
- [ ] **Delete a slide** that has a screenshot, wait for **Saved**, leave the editor → its file is deleted.
- [ ] Make about 60 more edits after replacing a screenshot (it falls out of undo history) → the old file is deleted after the next save, without leaving the editor.
- [ ] Remove a screenshot and refresh within 1 s ("Leave site?" → Leave) → the file is **kept**: nothing is deleted on a page refresh. That's the safe side; it stays as an orphan.
- [ ] Go Offline, remove a screenshot → status reads **Not saved** and the file is **not** deleted. Back online → after **Saved** and leaving, it is deleted.
- [ ] Reopen the project after each step → no slide shows a broken image.

**Open:** files orphaned before this cleanup existed, or by a refresh as above, are never removed (nothing scans the folder).
**Open:** with the same project open in two tabs, one tab can delete a file the other tab just added.

## 6. Add / move / delete slides

- [ ] **Add slide** adds "New headline" at the end and selects it.
- [ ] At 10 slides the Add slide tile disappears.
- [ ] ◀ / ▶ move the selected slide; ◀ is disabled on the first slide and ▶ on the last.
- [ ] Trash deletes the selected slide; disabled when only 1 slide is left.
- [ ] Delete the last slide → selection moves to the new last slide (right panel never goes blank).
- [ ] Each action can be undone (section 9).

**Open:** deleting a slide has no confirm. It relies on undo.

## 7. Device / background / layout / angle / text

- [ ] Device buttons list only the current store's devices; switching store resets to iPhone / Pixel.
- [ ] Canvas header size matches the device (e.g. 1320 × 2868 for iPhone).
- [ ] Swatches, **Custom colour**, **Panoramic background**, Text on top/below, Font, Text size and Device shadow all update the canvas immediately.
- [ ] **(regression)** Drag the custom colour picker around for a few seconds, then press Ctrl+Z **once** → the background goes back to the colour before you opened the picker (not one tiny step).
- [ ] (Supabase, Basic plan) 3D left / 3D right show "· Pro". Clicking shows "3D angles is on the Standard plan." and the angle doesn't change.
- [ ] Standard plan (or no Supabase): 3D angles apply.
- [ ] Typing a headline then pressing Ctrl+Z (outside the field) undoes the whole typing burst, not one letter.

## 8. Languages

- [ ] (Basic plan) Add language → "Localization is on the Standard plan."
- [ ] Add **Deutsch** → chip appears and is active. Headlines start as copies of the current text.
- [ ] Edit headlines in Deutsch, switch to English → English text is unchanged.
- [ ] Clear a headline completely in one language → it stays empty (doesn't fall back to English).
- [ ] Remove the active language → switches to the first remaining one. The ✕ is hidden when only one language is left.
- [ ] The "Add language…" list hides languages already added; with all 8 added, the picker disappears.

**Open:** removing a language deletes its translations without a confirm (undo restores them).

## 9. Undo / redo

- [ ] Undo/Redo buttons are disabled with no history.
- [ ] Ctrl+Z / Cmd+Z undo. Ctrl+Shift+Z and **(regression)** Ctrl+Y redo.
- [ ] Ctrl+Z inside the headline field does the browser's text undo, not an editor undo.
- [ ] Make a change after undoing → Redo becomes disabled.
- [ ] Undo after deleting slide 3 brings it back at position 3.
- [ ] **(regression)** Open Export, press Ctrl+Z → nothing changes behind the dialog.
- [ ] Undo history is per session: after a refresh, Undo is disabled (expected).

## 10. Save status / refresh mid-edit

- [ ] A change shows **Saving…**, then **Saved** (cloud) or **Saved in this browser** (local) after ~1 s.
- [ ] **(regression)** Rename the project by clearing the name field completely and typing a new one → the field can be emptied (it no longer snaps back to "Untitled project"). If left empty, it saves as "Untitled project".
- [ ] **(regression)** Local: type a headline and refresh **immediately** (< 1 s) → the edit is still there.
- [ ] **(regression)** Cloud: type and refresh immediately → the browser asks "Leave site?". Choose Stay; it saves.
- [ ] **(regression)** Type and click the logo within 1 s → reopen the project → the edit was saved.
- [ ] **(regression)** Cloud, go Offline, edit → **Not saved** + "Couldn't save … Retrying…". Back online → within ~5 s it saves without another edit, and the toast clears.
- [ ] **(regression)** Delete the project from My projects in another tab, then edit in the first tab → **Not saved** + "This project was deleted …" (it used to say "Saved").
- [ ] Slow 4G: many quick edits → status ends on **Saved**, never flips back to Saving incorrectly.

**Open:** signing out in another tab while a cloud project is open swaps the editor to "Sign in to open this project"; the last unsaved edit may be lost.

## 11. Export ZIP

- [ ] Export opens with sizes for the current device pre-ticked and the project's languages.
- [ ] Image count = sizes × languages × slides; untick everything → Download is disabled.
- [ ] Download → progress bar → ZIP named `<project-name>-screenshots.zip` with `<lang>/<size>/01.png …`.
- [ ] Open a PNG: exact store size (e.g. 1320 × 2868), fonts rendered, screenshots present.
- [ ] JPG format → `.jpg` files.
- [ ] Project with an empty name → file is `untitled-project-screenshots.zip`.
- [ ] **(regression)** While exporting, keyboard focus stays where it was (it used to jump to the first checkbox on every progress tick).
- [ ] **(regression)** Double-click **Download ZIP** fast → only one ZIP downloads.
- [ ] Esc, ✕, Cancel and clicking the backdrop close the dialog — except while exporting.
- [ ] (Supabase) Cloud screenshots appear in the export (no CORS errors in the console).

**Open:** the dialog doesn't trap Tab focus inside it.

## 12. My projects *(Supabase)*

- [ ] Signed out → `/projects` redirects to `/signin`.
- [ ] New account → "No projects yet." with **Start from a template**.
- [ ] Projects are sorted by last edit, with a first-slide preview, slide count and date.
- [ ] Click a preview → opens that project.
- [ ] **(regression)** If a browser-only project exists, a line offers "Open it" → `/editor/local`.
- [ ] A row with a broken or old `design` JSON (e.g. `{}`) shows a default preview instead of crashing the page.
- [ ] Offline on load → error message instead of "Loading…" forever.

## 13. Delete project *(Supabase)*

- [ ] **Delete** → confirm → **Cancel** keeps it.
- [ ] **OK** → button reads "Deleting…", other Delete buttons are disabled, then the card disappears.
- [ ] (After `0003_rls_fixes.sql`) Storage → screenshots → `<user id>/<project id>/` is empty after the delete. Other projects' folders are untouched.
- [ ] Without `0003_rls_fixes.sql` the project still deletes, but its files stay. Storage can't list or delete them without the SELECT rule.
- [ ] **(regression)** Offline → "Could not delete …" error and the card stays. (It used to fail silently with an unhandled error.)
- [ ] Opening a deleted project's URL → "Project not found …".

**Open:** signing in doesn't move the browser project into your account (only the "Open it" link above).
**Open:** the Standard plan's "Unlimited projects" isn't enforced; Basic users can make unlimited projects too.

## 14. Admin account *(Supabase, after running `0002_admin.sql`)*

- [ ] `select public.make_admin('<admin email>');` succeeds. An unknown email raises "No account with email …".
- [ ] Sign in as the admin → header shows **Admin · Pro** next to My projects.
- [ ] In the editor, 3D left / 3D right have no "· Pro" lock and apply. **Add language** works.
- [ ] A normal (Basic) account in another browser still sees the locks and no Admin badge.
- [ ] From the browser console as a normal user, `supabase.rpc('make_admin', { target_email: '<their email>' })` fails with a permission error.
- [ ] `select public.remove_admin('<admin email>');` → after a refresh the badge is gone and features are locked again.
- [ ] Before running `0002_admin.sql`, sign-in and plans still work (the app falls back to reading `plan` only).

## 15. Free positioning (drag, snap, resize)

- [ ] An existing project (made before this feature) looks exactly the same as before.
- [ ] On the selected slide, hover the headline or the device → move cursor. Other slides are still plain buttons that select on click.
- [ ] Click the device → purple outline and a white corner square. Click the slide background → the outline goes.
- [ ] Drag the headline down → it follows the pointer; the device does **not** move.
- [ ] Drag the device → the headline does **not** move.
- [ ] Drag near the slide's centre → pink guide line(s) appear and the element snaps to the centre. Release → the guides disappear.
- [ ] Hold **Alt** while dragging → no snapping.
- [ ] Drag the corner square outward / inward → the element grows / shrinks around its centre (limits 0.2×–4×).
- [ ] An element can't be dragged off the slide (its centre stays inside).
- [ ] Ctrl+Z after a drag undoes the **whole** drag in one step; Ctrl+Shift+Z redoes it.
- [ ] Click an element, press → three times and Shift+↓ once → it moves 3 right, 10 down. One Ctrl+Z undoes all four nudges.
- [ ] Arrow keys don't scroll the canvas; **+ / −** resize the focused element; **Esc** deselects.
- [ ] Tab reaches the headline and device on the selected slide (screen reader reads "Headline: drag to move…").
- [ ] Right panel → **Reset position on this slide** (shown only when something was moved) → back to the default layout; Undo restores the positions.
- [ ] Only the edited slide changes; other slides keep the default layout.
- [ ] Refresh → positions are kept. (Cloud) reopen from My projects → same positions, and the project card preview shows them.
- [ ] **Export** → the PNGs show the same positions and sizes as the canvas, at every size and in every language.
- [ ] Change **Text on top / Text below**, font or text size after moving → the moved element stays put; elements that weren't moved follow the layout.

**Open:** positions are in slide units from the top-left, so switching iPhone → iPad (a shorter slide) can leave a moved element low on the slide. Use Reset.
**Open:** `rotate` is stored and rendered, but there is no rotate handle yet.

## 16. Custom fonts *(Supabase, after `0004_fonts.sql`)*

- [ ] Signed out: **Font → Upload font…** → "Sign in to upload your own fonts." and the font doesn't change.
- [ ] Basic plan: the option reads "Upload font… (Pro)" → "Custom fonts are on the Standard plan."
- [ ] Standard plan: **Upload font…** opens a file picker for .ttf / .otf / .woff2.
- [ ] Upload a .ttf → toast "Added "<name>"", the select switches to it under **Your fonts**, and the canvas updates.
- [ ] Repeat with a .otf and a .woff2.
- [ ] File over 2 MB, a .ttc/.zip, a PNG renamed to .ttf, or a corrupt font → a clear error; nothing appears in Storage.
- [ ] Upload the same file twice → the second becomes "<name> (2)".
- [ ] Storage → fonts: the bucket is **private**; files are at `<your user id>/<random>.<ext>`. Table `user_fonts` has one row per font.
- [ ] Refresh the editor → the font loads again (Network tab: a signed URL with `token=`).
- [ ] **Export** → the PNGs use the uploaded font (compare with Inter; it must not fall back).
- [ ] My projects → the card preview uses the uploaded font.
- [ ] Undo after picking a font → the previous font returns; Redo brings it back.
- [ ] In another account, open the first account's signed URL after an hour → it has expired. Their `user_fonts` rows aren't visible.
- [ ] Delete the font's row/file in the dashboard, then reopen the project → text falls back to Inter, and the select shows "Uploaded font (unavailable)".
- [ ] `supabase/tests/rls_test.sql` still ends with **All RLS checks passed**. It now also checks the fonts bucket and table.

**Open:** there's no way to delete or rename an uploaded font in the app yet.
**Open:** one uploaded file covers every weight, so a separate bold file isn't paired with a regular one.

## 17. Landscape

- [ ] An existing project still opens in portrait and looks the same; nothing is saved until you touch the toggle.
- [ ] Left panel → Device → **Landscape** (on every device) → slides turn wide, the canvas header shows e.g. 2868 × 1320, and the device lies on its side next to the text.
- [ ] The layout buttons read **Text left / Text right** and swap the sides.
- [ ] iPhone, iPad, Pixel and Android tablet in landscape: the device sits fully inside the slide.
- [ ] Export lists only landscape sizes (2868 × 1320, 2778 × 1284, 2752 × 2064; Play 1920 × 1080, 2560 × 1440), and the PNGs have exactly those pixel sizes.
- [ ] Undo/Redo switches orientation back and forth. My projects previews show landscape projects wide.
- [ ] Moved elements (section 15) keep their positions, which may need **Reset position** after turning the slide.

**Open:** on iPad landscape the text column is narrow (~230 units), so long headlines wrap to 3–4 lines.

## 18. Google Play feature graphic

- [ ] Store **Google Play** → a 1024 × 500 artboard appears after the slides (after "Add slide"). App Store → it's hidden.
- [ ] Click it → header "Feature graphic · 1024 × 500"; slide move/delete are disabled; the right panel shows Headline, App icon and (with several languages) Language.
- [ ] The headline starts as slide 1's headline; typing changes only the feature graphic; one Ctrl+Z undoes the typing.
- [ ] **Upload icon** (or drop an image on the artboard) → a rounded icon appears left of the headline. **Remove icon** removes it. Non-images or files over 10 MB show an error.
- [ ] Background colour, panoramic shape and font follow the project.
- [ ] Add a language → the feature headline is copied for it; edit it per language; remove the language → its text goes.
- [ ] Export → "Feature graphic 1024 × 500" is listed and ticked; the ZIP has `<language>/feature-graphic.png` (or `.jpg`) at exactly 1024 × 500.
- [ ] Clicking a slide returns to the slide editor; uploading screenshots also returns to slides.
- [ ] (Cloud) replace or remove the icon, wait for **Saved**, leave the editor → the old icon file is deleted from Storage (section 5 rules).

**Open:** PNG export keeps an alpha channel (fully opaque). Google Play asks for "JPEG or 24-bit PNG (no alpha)" for the feature graphic and screenshots, and App Store Connect can reject PNGs with alpha. Choose **JPG** in Export until the PNGs are re-encoded. This applied to slides before this change too.

## 19. Backgrounds (gradient, image, per-slide)

- [ ] Existing projects look the same (solid colour, no extra layer).
- [ ] Background → **Gradient** → starts from the current colour at 135°. **From**, **To** and **Angle** update every slide live.
- [ ] Dragging the angle slider or a colour picker is **one** undo step.
- [ ] Panoramic on: the gradient flows across slides with no visible seam between neighbours. Panoramic off: each slide shows the whole gradient.
- [ ] A light gradient switches the text to dark; a dark one to white.
- [ ] Background → **Image → Add** → the image covers every slide (above the gradient). **Remove** takes it away.
- [ ] Select slide 2 → **Slide 2** → change colour/gradient/image → only slide 2 changes, and the hint says it has its own background. Other slides keep the project background.
- [ ] Selecting a slide with its own background switches the toggle to **Slide N**; other slides show **All slides**.
- [ ] **Use the project background** removes the override; Undo brings it back.
- [ ] A slide with its own background is not part of the panoramic strip; its neighbours still join each other.
- [ ] Export → PNGs show the same gradients, images and seams as the canvas. The feature graphic uses the project background.
- [ ] (Cloud) replace or remove a background image, wait for **Saved**, leave → the old file is deleted (section 5 rules).

## 20. Saved templates *(Supabase, after `0005_user_templates.sql`)*

- [ ] Signed out: **Save as template** → "Sign in to save your own templates."; Basic plan → "Saved templates are on the Standard plan."
- [ ] Standard: **Save as template** → name prefilled with the project name → **Save template** → "Saved "…" to My templates." A blank name shows an error.
- [ ] /templates → **My templates** (URL `?tab=mine`) lists it with a real first-slide preview, store and date. Signed out it asks you to sign in.
- [ ] **Use** → a new cloud project with the same device, background (gradient/image), fonts, layout, slide text and positions, and no screenshots.
- [ ] The new project's background image is in its own folder (`<user>/<project>/…`), not the template folder.
- [ ] Delete the original project → the template still shows its background image. Delete the template → projects made from it keep theirs.
- [ ] **Delete** a template → confirm → it disappears; its files in `<user>/templates/<id>/` are gone.
- [ ] Another account never sees your templates. `rls_test.sql` still ends with **All RLS checks passed** (it now checks `user_templates` too).

**Open:** per-slide background *images* and the feature-graphic icon are not saved in templates (only their colours/gradients).

## 21. Auto-translate and right-to-left *(Supabase, after deploying `translate` — README §5)*

- [ ] Add a language → the right panel shows **Auto-translate to <language>**. On the main (first) language, there's no button.
- [ ] Signed out, Basic plan, or a browser-only project → a clear notice in the toast; nothing is sent.
- [ ] Standard: click it → the toast says "Translating to …" and the button reads "Translating…" (disabled) until it finishes.
- [ ] Every slide's headline and subtitle in that language are replaced; line breaks in headlines are kept.
- [ ] Toast: "Translated N slides to …" with how many calls are left today.
- [ ] Type in the main language and click Auto-translate within a second → the translation uses the new text (it saves first).
- [ ] **One** Ctrl+Z reverts the whole translation; Ctrl+Shift+Z re-applies it.
- [ ] Network tab: one call to `/functions/v1/translate` with your Bearer token; the provider gets one batch (function logs).
- [ ] Wrong or missing API key, DeepL quota used up, Hindi with DeepL, function not deployed, offline → a readable error in the toast; text unchanged.
- [ ] Call it 51 times in one UTC day → the 51st says the 50-a-day limit is reached (`translate_usage.count` stays at 50).
- [ ] Another user's project id → 404 (RLS); a Basic user → 403; no token → 401 (e.g. with curl).
- [ ] Add **العربية** or **עברית** → the slide text and the headline/subtitle fields are right to left (`dir="rtl"`); export shows RTL too. Other languages are unchanged.
- [ ] `deno test supabase/functions/translate/` passes. `rls_test.sql` still ends with **All RLS checks passed** (it now checks `translate_usage` and the limit).

**Open:** the feature graphic's headline isn't auto-translated, only the slides.

