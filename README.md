# Trip Ledger

Trip Ledger is a small installable iPhone-friendly expense tracker for work travel.

It lets you:

- Save the amount, expense date, location, notes, date submitted, and date reimbursed
- Attach a receipt photo from the camera or photo library
- Filter expenses by reimbursement status
- Export a JSON backup so your records are not trapped on one device
- Open a PrismJet pilot scheduling page for shared days-off requests

## Why this version is a web app

This is the fastest way to get you a usable iPhone app without dealing with the App Store first.

Once this page is hosted online, you can open it in Safari on your iPhone and use **Add to Home Screen**. It will behave like an app and can work offline after the first load.

## Files

- `index.html`: app layout
- `schedule.html`: pilot days-off bid calendar
- `schedule.js`: pilot PIN flow, calendar selection, cumulative monthly request limits, cancellation, and Google Apps Script calls
- `schedule-config.js`: public URL config for the deployed Google Apps Script web app
- `google-apps-script/prismjet-schedule.gs`: Google Sheets backend template for PINs and requests
- `styles.css`: mobile-first styling
- `app.js`: expense storage, photo handling, filters, import/export
- `manifest.webmanifest` and `service-worker.js`: installable/offline support

## Local preview on your Mac

From this folder, run:

```bash
python3 -m http.server 8000
```

Then open:

[http://127.0.0.1:8000](http://127.0.0.1:8000)

## Using it on your iPhone

You have a few easy options:

1. Host these files on a simple static site such as GitHub Pages, Netlify, or Vercel.
2. Open the hosted site in Safari on your iPhone.
3. Tap **Share** then **Add to Home Screen**.

## Pilot scheduling setup

The schedule page runs in local demo mode until a Google Apps Script URL is added to `schedule-config.js`.

Demo PINs:

- Pilot A: `1111`
- Pilot B: `2222`
- Pilot C: `3333`

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

Keep real pilot PINs in Apps Script only. Do not replace the sample PINs in the GitHub copy if this repository will be public.

Pilots can change a submitted day by tapping their own day in the submitted requests list, confirming cancellation, and submitting the corrected day again. Cancelled rows stay in the Google Sheet with `Status` set to `cancelled`.

## Important note about storage

Expenses are stored locally in your browser using IndexedDB. That means:

- Your data stays on the device/browser unless you export it
- Clearing browser/site data can remove saved expenses
- Exporting backups regularly is a good idea

## Good next step

If you want, the next step can be publishing this so it works on your phone, or converting it into a native iPhone app later.
