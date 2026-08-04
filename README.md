# Smoke420 — Cannabis Dispensary POS

A sales capture and inventory management system for a small cannabis dispensary. Built with vanilla HTML/CSS/JS, uses Google Sheets as a database via Apps Script, and is hosted on GitHub Pages.

This is the staff-facing POS, served from `/POS/`. The repo root (`index.html`, `terms/`, `privacy/`, `refunds/`, `legal/`) is a separate public marketing/membership site with its own backend in `APPSSCRIPT_waitlist.js`. This README covers the POS only.

---

## What it does

- **PIN login** — staff login with 4-digit PINs (SHA-256 hashed, never sent anywhere)
- **Capture sales** — product, quantity, price, customer, cash or EFT
- **Customer database** — auto-creates customers on first purchase, tracks visits and spend
- **Inventory management** — product catalogue, stock levels, restock logging
- **Sales log** — filterable by month, staff, product, payment method
- **Reports** — ASCII bar charts, best sellers, staff performance, monthly revenue
- **Admin panel** — staff management, audit log, settings, data export
- **Google Sheets sync** — all data backed up to a live Google Sheet
- **Offline-first** — works without internet; syncs automatically when reconnected

---

## 1. Deploy Google Sheets + Apps Script

### Create the spreadsheet
1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Name it **Smoke420**

### Add the Apps Script
1. In the spreadsheet: **Extensions → Apps Script**
2. Delete all existing code in the editor
3. Paste the entire contents of `APPSSCRIPT.js` from this project
4. Press **Ctrl+S** (or Cmd+S) to save

### Deploy as a Web App
1. Click **Deploy → New deployment**
2. Click the gear icon next to "Type" and select **Web app**
3. Set:
   - **Execute as**: Me
   - **Who has access**: Anyone
4. Click **Deploy**
5. Authorise the app when prompted (click through the Google permissions dialog)
6. Copy the **Web app URL** — it looks like:
   `https://script.google.com/macros/s/AKfy.../exec`

### Enter the URL in the app
1. Open the POS in a browser (`/POS/`)
2. Log in as admin → go to the **SETUP** tab (F8)
3. Paste the URL into the **Apps Script URL** field and click **SAVE**
4. Click **TEST CONNECTION** to verify

The app will now sync all sales, inventory changes, and customer records to your Google Sheet automatically.

---

## 2. Deploy to GitHub Pages

```bash
# 1. Navigate to the project folder
cd /path/to/smoke420

# 2. Initialise git and create the first commit
git init
git add .
git commit -m "Initial build — Smoke420 POS"

# 3. Create a GitHub repository named 'smoke420'
#    (do this at github.com → New repository)

# 4. Add remote and push
git remote add origin https://github.com/YOUR_USERNAME/smoke420.git
git branch -M main
git push -u origin main

# 5. Enable GitHub Pages
#    → Repository Settings → Pages → Source: Deploy from branch
#    → Branch: main / root → Save

# The marketing site will be live at:
# https://YOUR_USERNAME.github.io/smoke420/
# The POS will be live at:
# https://YOUR_USERNAME.github.io/smoke420/POS/
```

---

## 3. Configure Staff PINs (First Run)

The first time you open the app, a **Setup Wizard** appears automatically because no PINs are configured.

1. For each **admin** (GHST, RAY), click **SET PIN**
2. Enter a 4-digit PIN twice to confirm
3. Once at least one admin has a PIN, click **SETUP COMPLETE**
4. Log in using your PIN

**Existing staff** (STAFF1, STAFF2, STAFF3) can have their PINs set by an admin:
- Log in as admin → **ADMIN** tab (F7) → **STAFF MANAGEMENT**
- Click **RESET PIN** next to the staff member's name
- Confirm with your admin PIN, then set the new PIN

---

## 4. Staff Roles

| Role  | Access |
|-------|--------|
| admin | Everything — dashboard, inventory, customers, reports, admin panel |
| staff | Capture Sale + own Sales Log only |

---

## 5. File Structure

```
smoke420/
├── index.html, terms/, privacy/, refunds/, legal/   # Public marketing/membership site
├── APPSSCRIPT_waitlist.js                           # Backend for the site above
├── assets/                                          # Shared branding (logos, favicons)
├── POS/                                             # The POS app covered by this README
│   ├── index.html     # Single-page app shell
│   ├── config.js      # Constants, seed staff and products
│   ├── css/styles.css # Terminal POS design
│   ├── js/
│   │   ├── data.js       # localStorage + Google Sheets sync
│   │   ├── auth.js       # PIN login, sessions, setup wizard
│   │   ├── ui.js         # Navigation, toasts, modals, clock
│   │   ├── sales.js      # Sale capture + Sales Log
│   │   ├── inventory.js  # Stock management
│   │   ├── customers.js  # Customer database
│   │   ├── reports.js    # Revenue charts and stats
│   │   └── admin.js      # Admin panel + Setup tab
│   └── APPSSCRIPT.js  # Paste into Google Apps Script
├── USERMANUAL.md     # Plain English staff guide
└── README.md         # This file
```

---

## 6. Keyboard Shortcuts

| Key | Tab |
|-----|-----|
| F1 | Dashboard (admin) |
| F2 | Capture Sale |
| F3 | Sales Log |
| F4 | Inventory (admin) |
| F5 | Customers (admin) |
| F6 | Reports (admin) |
| F7 | Admin Panel (admin) |
| F8 | Setup |

---

## 7. Offline Mode

The app works fully offline. All data is saved to `localStorage` immediately. When internet is available, it syncs to Google Sheets in the background. The bottom bar shows:

- **SYNCED** — everything is up to date
- **SYNCING** — currently sending data
- **OFFLINE** — no Apps Script URL configured, or no internet

---

## Troubleshooting

**Wrong PIN / locked out**: Admin can reset any PIN from Admin → Staff Management → Reset PIN.

**Data lost after clearing browser**: Data lives in `localStorage`. Encourage users not to clear browser data. The Google Sheet is the backup — use Admin → Data Management → Manual Sync to restore.

**Sync fails**: Check the Apps Script URL in Setup tab. Re-deploy the Apps Script if needed (it generates a new URL each time).
