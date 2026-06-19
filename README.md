# PrismJet Scheduling

PrismJet Scheduling is an installable, phone-friendly pilot days-off request app.

It lets pilots:

- Log in with a simple pilot PIN
- View a shared bid-month calendar
- Select OFF or PTO days with high, medium, or low priority
- Submit up to 8 OFF days and 14 combined OFF + PTO days per month
- Cancel their own submitted days by tapping them on the calendar

It also prevents more than one pilot from being off on the same day for a 3-pilot crew. The `1111` PIN is the admin login, which can export the month, clear a selected month, and add scheduled trip markers for visibility.

## Files

- `index.html`: redirects to the scheduler so the expense tracker screen is not the app entry point
- `schedule.html`: pilot scheduling interface
- `schedule.js`: PIN flow, calendar selection, monthly limits, cancellation, trip markers, one-pilot-per-day rule, and export
- `schedule-config.js`: public URL config for the deployed Google Apps Script web app
- `google-apps-script/prismjet-schedule.gs`: Google Sheets backend template for PINs, requests, and scheduled trips
- `manifest.webmanifest`, `service-worker.js`, and `assets/schedule-icon.svg`: installable app shell and home-screen icon

## Local Preview

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open:

[http://127.0.0.1:8000/schedule.html](http://127.0.0.1:8000/schedule.html)

Demo PINs:

- Adam Barkley: `1111`
- Ian Crouse: `2222`
- Zach Stolarow: `3333`

## Shared Google Sheets Setup

The schedule page runs in local demo mode until a Google Apps Script URL is added to `schedule-config.js`.

To make the calendar shared:

1. Create a Google Sheet for pilot requests.
2. Open **Extensions > Apps Script** from that sheet.
3. Paste the contents of `google-apps-script/prismjet-schedule.gs`.
4. In Apps Script, change any pilot names, initials, colors, PINs, and the `adminPin` if needed.
5. Click **Save**.
6. Select `setupScheduleSheet` in the function dropdown, click **Run**, and approve the requested permissions. This creates the `Pilot Requests` and `Scheduled Trips` sheet tabs.
7. Click **Deploy > New deployment**.
8. Choose **Web app**.
9. Set **Execute as** to **Me**.
10. Set **Who has access** to **Anyone**.
11. Click **Deploy**, then copy the Web app URL ending in `/exec`.
12. Paste that URL into `schedule-config.js`:

```js
window.PRISMJET_SCHEDULE_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

Keep real pilot PINs in Apps Script only. Do not put real PINs in the public GitHub app code.

## Export

Use the hamburger menu in the scheduler while signed in with PIN `1111` to export or clear the selected bid month. The download is an Excel-compatible CSV listed by pilot, with scheduled trips included as separate trip entries.
