# Estancia Amenities — Project Context

A single-file handoff document. Load this into a fresh session to resume work
without re-deriving the architecture. Last updated covering: amenity-column-in-logs
+ swipe-to-checkout.

---

## What it is

An **Android-only** React Native / **Expo SDK 56** app that gates entry to a
residential community's amenities (gym / pool / tennis) and logs in/out
attendance. One phone is deployed per amenity. Built and sideloaded as a local
gradle release APK (debug-keystore signed).

- **Package:** `com.estancia.amenities`  ·  **Display name:** "Estancia Amenities"
- **Routing:** expo-router (file-based, `src/app/`), React Native 0.85, Hermes, React Compiler
- **Git:** remote `https://github.com/saravanans-0753/estancia_club.git`, branch `main`
- **Reference app:** IDCHECKER at `/Users/saravanans-0753/work/idchecker` (scanner, sheet-pull, ZIP-photo patterns were copied/adapted from it)

> **AGENTS.md / CLAUDE.md instruction:** Expo SDK 56 — read the exact versioned
> docs at https://docs.expo.dev/versions/v56.0.0/ before writing code.

---

## Core user flows

### Home (`src/app/index.tsx`)
- ⚙ admin icon (top-left → `/admin`), 👥 inside icon (top-right → `/inside`)
- "GATING: <amenity>" bar with a "👥 N INSIDE" pill (tap → `/inside`)
- **Dashboard strip**: Today's Entries / Inside Now / Unsynced cards + "Last sync: Xago" line (today's counts from local `getTodayStats`, bumped in `enqueueLog`; last sync from `getLastSyncTime`; unsynced from `getPendingCount`)
- Big **IN** / **OUT** buttons
- Randomized inspirational confirmation Modal shown after a check-in/out (one-shot handoff)

### Ops features
- **Auto-checkout** (`src/services/auto-checkout.ts`, run from `_layout.tsx` on mount/15s/active): closes "inside" sessions from a previous day or older than `getAutoCheckoutHours()` (default 4) — logged as `OUT` with status `AUTO`, removed from the registry.
- **Defaulters report** (`src/app/defaulters.tsx`, Admin → DEFAULTERS): reads the attendance log, lists this month's unpaid IN attempts (WARN/REGISTER/DENIED) grouped by flat+name with attempt count + last status.

### Check IN
`/checkin` (Family / Student / Guest chooser) →
- **Family / Guest:** `src/components/attendance-form.tsx` (Family remembers entered names per flat for autofill; Guest remembers nothing)
- **Student:** `src/app/student.tsx` — camera barcode scan **or** manual numeric input that accepts **student ID OR flat number**; shows face photo + name + type badge

On Check In, `decideEntry()` runs a **subscription/date-band escalation** (see below),
optionally plays a buzzer overlay, logs the attempt, then returns home with a
confirmation message.

### Check OUT (two ways)
1. `/checkout` — enter flat (numeric) → pick from the flat's checked-in people → CHECK OUT
2. `/inside` ("People Inside" report) — **swipe a name left** to reveal a red CHECK OUT action

Both log an `OUT` row, remove the person from the device-local checked-in registry, and update counts.

### Subscription decision logic (`src/services/subscription.ts`)
`decide(category, paid, dayOfMonth)` (pure) + `decideEntry()` (reads deployed amenity + paid status). Bands:
- **day < 5:** polite warning, still logs (WARN)
- **day 5–10:** stronger "please use the register" but still logs (REGISTER)
- **day > 10:** **deny + buzzer** (DENIED)
- **Students** — three states: (1) **no matching subscription row** for flat+name+amenity → CHECK IN hidden, shows **"No subscription yet"** (`hasStudentSubscription`); (2) subscription exists but **not paid this month** → day ≤ 5 allow + "record in notebook" (REGISTER), day > 5 **deny + buzzer**; (3) **paid this month** → PAID.
- Guests: NA. "Paid" = a current-month subscription row that **covers the deployed amenity** (combo subscriptions list multiple amenities).

---

## Data architecture

### Google Apps Script web apps (token-guarded, `token = Admin2026`)

| Purpose | URL ends in | Actions | Backs |
|---------|-------------|---------|-------|
| **Read proxy** | `…3Dwrgfm7pkw` | `get_csv`, `get_zip` | Subscriptions sheet + faces ZIP (also reused to read the log sheet for reports) |
| **Write app** | `…Xyii-v4DjQ` | `append_log` | Attendance log sheet |
| **Subscription writer** | *(deploy + paste URL into `admin.html` & `sheets.ts`)* | `insert_rows`, `existing_keys`, `get_rows` | Amenity payments sheet (gym/swimming/tennis/combo tabs) — write **and** the app's gating read |
| **Razorpay payments** | *(deploy `razorpay-payments.gs`; post URL/QR at gates)* | `doGet` page + `confirm`; `doPost` `webhook` | Resident self-serve payment → writes "paid" rows into the same amenity payments sheet |

The deployed `Code.gs` for the log write app **is** `apps-script/log-writer.gs`;
for the subscription writer it **is** `apps-script/subscription-writer.gs`
(both self-contained; paste the whole file, Deploy ▸ Manage deployments ▸ New version).
There is no longer an `append_log.gs` — it was a redundant snippet for an
alternative "bolt onto the read proxy" approach and was deleted.

### Razorpay QR payment at the kiosk (primary flow)
On an unpaid check-in the decision overlay shows **PAY NOW** (`decision-overlay.tsx` `onPayNow`,
wired from `attendance-form.tsx` + `student.tsx`) → **`src/app/pay.tsx`**: tick Gym/Swimming/Tennis,
the **Amount Payable** is the price whose **category (Student/Family) + Covers set** match the
selection (`amountForSet`), tap **SHOW QR CODE** → the app calls `razorpay-payments.gs` `create_qr`,
which creates a **Razorpay Payment Link** and returns its URL; the app renders that URL as a **QR
on-device** (`qrcode-generator`, GIF data-URI — no native dep) for the resident to scan & pay with any
UPI app. (Razorpay's QR-Codes API was NOT enabled on the account, but Payment Links are — so we render
the link URL as the QR.) It polls `qr_status` (link status); on payment the backend writes the paid
row(s) — bank-statement style description (`"Jul26 - Combo pack of Gym, Swimming & Tennis for Flat
No. 1137 : Name"`, single → `"Jul26 - Gym Fee for Flat No. …"`), single amenity → its tab, 2+ →
combo tab; idempotent on flat+month+covers. The app
`addPaidSubscriptions` locally + auto-checks-in for this gate. Client: `src/services/payments.ts`
(`PAY_APPS_SCRIPT_URL` = deployed `/exec`; `PAY_TOKEN` matches the script). Needs kiosk internet.

### `apps-script/razorpay-payments.gs` — Razorpay backend (QR endpoints + resident self-serve page)
Endpoints: `create_qr` / `qr_status` (kiosk QR, token=`PAY_TOKEN`), `packages` (prices), plus the
older resident-phone Payment-Link page (`doGet` default + `confirm` callback + `webhook`). **Prices
are hardcoded** in the `PACKAGES_` array (per category Student/Family × amenity combination) — edit
there, no sheet needed. Razorpay keys are read from **Script Properties** (`RAZORPAY_KEY_ID` /
`RAZORPAY_KEY_SECRET` via `PropertiesService`), so the file carries no secret and is safe to commit.
A new web app (deploy separately, Execute as Me / Anyone). A resident opens its
`/exec` URL on their **own** phone (post the URL / a QR at each gate), picks a
**package** + month, enters flat + name, sees the price, and taps Pay. It creates
a **Razorpay Payment Link** server-side (key secret stays in the script) and hands
back the `short_url`. On payment it writes a **"paid" row** into the subscription
sheet in the exact layout `sheets.ts` reads — a **single-amenity** package goes to
its own tab; a **multi-amenity** package goes to the **combo** tab with a
Payment Description that both begins with the clean month (`monthFromText`) **and
names the covered amenities** (e.g. `"Jul 2026 - Gym & Swimming for Flat 1137 : …"`)
so the app's `amenitiesFromText` grants exactly those. **Kiosk needs no code change**;
gating works after its next sync. Two authoritative confirmation paths, both re-fetch
the link from Razorpay's authed API before writing and are **idempotent** on the
payment id: (1) `callback_url → doGet(action=confirm)` verifies the payment-link
callback signature (query params, readable in `doGet`); (2) `doPost(action=webhook&token=…)`
backstop (Apps Script **can't read the `X-Razorpay-Signature` header**, so the URL
is token-guarded and we re-verify via the API). Prices are hardcoded in `PACKAGES_`.
Before the kiosk QR flow works: add the Razorpay keys in Apps Script **Project Settings ▸
Script Properties** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`), deploy the web app, and paste
its `/exec` URL into `PAY_APPS_SCRIPT_URL` in `src/services/payments.ts`.

### `admin.html` — standalone subscription-sheet updater (browser tool, not in the app)
Open `admin.html` in a browser to load monthly bank-statement exports
(`Gym Paid Llist.xlsx`, `Gym & Swimming.xlsx`, `Tennis.xlsx` — title row + blank +
`Slno | Flat No. | Name | Description | … | Amount`). It parses each file with SheetJS
(CDN), lets the admin pick the target tab, previews normalized rows, and POSTs
`{action:'insert_rows', token, ssId, gid, rows:[[S.No., APT NO., NAME OF CLIENT, Amount]]}`
to the subscription writer, which **inserts them at the top** of the chosen tab (below the
header — nothing is cleared). Set `ENDPOINT` in the file to the deployed `/exec` URL first.
**Combined statements:** a file that mixes amenities is auto-detected and shown in **SPLIT BY
AMENITY** mode (toggle per card) — each row is classified from its Description (`classifyAmenity`:
counts the amenity keywords present → **2 or more ⇒ `combo`** (e.g. "Gym and Swimming …",
"Combo pack of Swim & Tennis …"), else the single `tennis`/`swimming`/`gym`; the bare word "combo"
is NOT keyed on, so "Tennis Court … Combo Balance for Tennis" stays tennis) and PUSH fans the rows
out to the tabs in separate batches. Column detection is tolerant (flat = `Flat No.`/`APT NO.`/**`USN`**,
description = `Payment Description`/`Description`/`head`). **Comma-in-description overflow:** a bank
export like "CUB Report" splits a description containing a comma (e.g. "Combo pack of Gym, Swimming &
Tennis") into extra columns, pushing **Amount** rightward. Since Amount is the last column, the parser
reads Amount from the row's last non-empty cell and rebuilds the description by joining the cells
between its start and the trailing columns (restoring the comma) — so classification + amount stay
correct. The preview shows only matched rows; unrecognized ("other")
rows are dropped from the preview and skipped on push (header shows an "N skipped" tally). Before
each batch, **duplicates are automatically dropped, not prompted** (`dedupeRows` + `existing_keys`
action) — key = **APT NO. + AMENITY USER + Month** (identifies the same subscription regardless of
which statement it came from; the S.No. differs per statement so it is NOT in the key, else the same
person re-appears from a second file). The server derives Month from the Payment Description text
(the Month cell is date-coerced by Sheets). **Redeploy `subscription-writer.gs`** after any key
change so the sheet-side check matches the client. Target sheet
`1OhbhJPxep0s5eQKmakgmSjJBIMDEzSN3iRXuGMaOCng`; tab gids gym `2051574635`, swimming `1433427596`,
tennis `2028550937`, combo `1913121077`. Columns: `S.No. | APT NO. | NAME OF CLIENT | AMENITY USER
| Month | Amount | Payment Description` (AMENITY USER + Month are parsed out of the bank
statement's Description text).

### Spreadsheets
- **Subscriptions (gating source)** — sheet `1OhbhJPxep0s5eQKmakgmSjJBIMDEzSN3iRXuGMaOCng`, read by
  the app via the **subscription writer** `get_rows` action (ssId passed explicitly). One tab per
  amenity: gym `2051574635`, swimming `1433427596`, tennis `2028550937`, combo `1913121077`.
  `fetchSubscriptionStudents` (`sheets.ts`) maps each row → `Student{flat=APT NO., name=AMENITY
  USER, month=Month, amenity=<tab>}`; a **combo** row is expanded into one record per amenity it
  covers — parsed from that row's own **Payment Description** via `amenitiesFromText` (gym/swimming/
  tennis, any mix; falls back to gym+swimming if unparseable) — so the exact-match `coversAmenity`
  gate passes on exactly what was paid for. Combos of any mix (gym+swim, swim+tennis, …) all live in
  the single **combo** tab; the app validates coverage from each row's description. The amenity vocabulary is **gym / swimming /
  tennis** (the old `pool` term was renamed to `swimming`; a device previously deployed as `pool`
  must re-pick `swimming` in Admin). The old subscription tab `1EDvYjD…/gid 716123554` is no longer
  read.
- Spreadsheet id `1EDvYjDQVIpwib5PmQ5sbSchJI_B5HNHWNomXRLOxtk4` still hosts the **roster the app syncs**:
  - **Student roster ("Student id")** — gid `0`. Columns: `Name, Flat, ValidFrom, ValidTill, Aadhar, Mobile, ID, Update`. Maps **Student ID (`ID`) → Name + Flat**. Face photos are named by this **Student ID**.
  - **Student flow:** student enters/scans their **Student ID** → roster resolves name/flat/photo → gate requires the **flat + name combination** to exist in the subscription rows for the deployed amenity. Name match is tolerant (`namesSimilar`: the FIRST name — first significant word ≥3 letters — must agree, with containment + Levenshtein typo tolerance; trailing last names and initials are ignored). E.g. "Saravanan Sengamalam" ~ "saravanan" ~ "saravanan.s" (match), but ≠ "sengamalam". Family/Guest still gate by flat only.
- **Attendance log:** id `1FDIJ5xJWDG6BTwf_jwn8QQIurZY7x2NI4xpxFEbM_80`, gid `1191732374`
  - Columns: `Timestamp, Category, Flat No, Name, Gender, Student ID, Direction, Subscription, Amenity`
  - **Amenity** is the newest column (last position, self-migrating header in the script).
  - `Subscription` here = the decision status (PAID/WARN/REGISTER/DENIED/NA/'' for checkout).

### Faces
`faces.zip` in Google Drive (~36 MB, ~1597 images), fetched via the read proxy's
`get_zip` (base64). Images are named by **Student ID**; only the roster's IDs are
extracted to `documentDirectory/student_photos` to keep it fast. `photos.ts`
exposes a generic `attachLocalPhotos(items, getKey)` (roster attaches by `id`).

---

## Key files

### Services (`src/services/`)
- **storage.ts** — Two stores: **subscriptions** `Student {flat,name,month,status,type,amenity}` (flat = key; dedup `flat|name|amenity|month`; `coversAmenity` = `s.amenity===a`; `isFlatPaidThisMonth`, `getAmenityOptions`) and **roster** `RosterEntry {id,name,flat,validTill,local_photo?}` (`getRoster`, `saveRoster`, `getRosterById`). Tolerant month match. Deployed-amenity + admin-passcode (default `1234`). Family autofill history. **Checked-in registry** (`CheckedInEntry`; Students keyed by `S:<studentid>`, Family/Guest by `category:flat:name`) — device-local, powers check-out.
- **sheets.ts** — Apps Script URLs/IDs/token (hardcoded, internal tool — not a real secret). `AttendanceLogRow` (now includes optional `amenity`). `postAttendanceLog`, `fetchLogRows` (reads `Amenity`), `syncStudents({photos?})` (Subscription→amenities, ZIP only if photos), CSV parsing copied from IDCHECKER.
- **log-queue.ts** — `enqueueLog` writes to an AsyncStorage queue with client timestamp + qid and **auto-fills `amenity` from `getDeployedAmenity()` (uppercased)**; fire-and-forget `flushLogs` (POSTs each, stops on first failure to preserve order/retry). Background flush is driven from `_layout.tsx` (mount + 15s interval + AppState active).
- **subscription.ts** — decision logic (above).
- **report.ts** — `buildReportHtml(mode, value)` for daily/monthly PDF: filter log rows, aggregate, inline SVG pie chart + legend + observations.
- **photos.ts** — JSZip extract wanted IDs, attach local photos, clear.
- **confirmation.ts** — `CHECKIN_MESSAGES`/`CHECKOUT_MESSAGES` arrays + one-shot `setPendingConfirmation`/`consumePendingConfirmation`.

### Screens / components (`src/app/`, `src/components/`)
- `_layout.tsx` — root: GestureHandlerRootView wrapper + background log flush; registers all routes.
- `index.tsx` (home), `admin.tsx` (passcode gate → sync/export/amenity-selector/change-passcode via inline Modal), `inside.tsx` (people-inside report + swipe-to-checkout), `checkin.tsx`, `checkout.tsx`, `family.tsx`/`guest.tsx` (wrap `attendance-form.tsx`), `student.tsx`, `export.tsx`.
- `components/attendance-form.tsx` (shared Family/Guest; pinned CHECK IN footer; `KeyboardAvoidingView behavior="padding"`), `components/decision-overlay.tsx` (full-screen colored modal + buzzer via expo-audio).
- `assets/sounds/buzzer.mp3` (from IDCHECKER's failure.mp3).

---

## Build / deploy / verify

```bash
# Build release APK
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk

# Install (adb is NOT on PATH; use the SDK path)
"$HOME/Library/Android/sdk/platform-tools/adb" install -r \
  android/app/build/outputs/apk/release/app-release.apk

# Typecheck
npx tsc --noEmit
```
- Device is 1080×2340. Verify on-device via adb screenshots downscaled with `sips -Z` (image read size limit).
- Admin passcode: **1234** (changeable in admin panel).

---

## Gotchas learned the hard way
- Sheet is private → **must** go through the Apps Script proxy (direct CSV = 401).
- SDK 56 **edge-to-edge** neutralizes `adjustResize` → keyboard hides buttons unless you use `behavior="padding"` + a pinned footer.
- Old cached `Student` rows lacked `amenities` → `s.amenities.includes()` threw and silently aborted check-in → always guard `(s.amenities||[])`, then re-sync.
- `Alert.prompt` doesn't work on Android → use an inline Modal for text input (e.g. change-passcode).
- curl POST to Apps Script can return "Page not found" (302 quirk) even when the write succeeded; RN `fetch` handles it fine.
- After adding the `Amenity` column, **the write Apps Script must be redeployed** (paste `log-writer.gs`, New version) or the column won't appear — the app keeps logging fine meanwhile (extra field is ignored).

---

## Uncommitted work (as of this doc)
Both pending, not yet committed since the last commit:
1. **Swipe-to-checkout** on the Inside report (`inside.tsx` + GestureHandlerRootView in `_layout.tsx`).
2. **Amenity column** in logs (`sheets.ts`, `log-queue.ts`, `apps-script/log-writer.gs`) + deletion of `apps-script/append_log.gs`.

Project convention: **commit only when the user explicitly says so.** Bash commands run without permission prompts for this project.
