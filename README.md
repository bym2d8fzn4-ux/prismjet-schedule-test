# PrismJet Scheduling

PrismJet Scheduling is an installable, phone-friendly pilot days-off request app.

It lets pilots:

- Log in with a simple pilot PIN
- View a shared bid-month calendar
- Select OFF or PTO days with high, medium, or low priority
- Submit up to 8 OFF days and 14 combined OFF + PTO days per month
- Cancel their own submitted days by tapping them on the calendar

It also prevents more than one pilot from being off on the same day for a 3-pilot crew.

## Files

- `index.html`: redirects to the scheduler so the expense tracker screen is not the app entry point
- `schedule.html`: pilot scheduling interface
- `schedule.js`: PIN flow, calendar selection, monthly limits, cancellation, one-pilot-per-day rule, and export
- `schedule-config.js`: public URL config for the deployed Google Apps Script web app
- `google-apps-script/prismjet-schedule.gs`: Google Sheets backend template for PINs and requests
- `manifest.webmanifest`, `service-worker.js`, and `assets/schedule-icon.svg`: installable app shell and home-screen icon

## Local Preview

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open:

[http://127.0.0.1:8000/schedule.html](http://127.0.0.1:8000/schedule.html)

Demo PINs:

- Pilot A: `1111`
- Pilot B: `2222`
- Pilot C: `3333`

## Shared Google Sheets Setup

The schedule page runs in local demo mode until a Google Apps Script URL is added to `schedule-config.js`.

To make the calendar shared:

1. Create a Google Sheet for pilot requests.
2. Open **Extensions > Apps Script** from that sheet.
3. Paste the contents of `google-apps-script/prismjet-schedule.gs`.
4. In Apps Script, change the three pilot names, initials, colors, and PINs.
5. Run `setupScheduleSheet()` once and approve the requested permissions.
6. Deploy as a **Web app** with **Execute as: Me** and **Who has access: Anyone**.
7. Copy the `/exec` web app URL.
8. Paste that URL into `schedule-config.js`:

```js
window.PRISMJET_SCHEDULE_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec";
```

Keep real pilot PINs in Apps Script only. Do not put real PINs in the public GitHub app code.

## Export

Use the hamburger menu in the scheduler to export the selected bid month. The download is an Excel-compatible CSV.
