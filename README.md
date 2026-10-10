# ReturnPulse

**AI-driven no-show reminder desk for clinics** — a follow-up log that colour-codes every
patient by how close their checkup is to right now, then drafts the reminder for you.

No database. No sign-up. No server. Every record is written straight to the browser's
`localStorage` the moment you save it.

---

## Run it

It is a static site — any static file server works.

```bash
# from the repo root
python3 -m http.server 8080
# → http://localhost:8080
```

Then open the printed address on a phone or a desktop. On Chrome (desktop or Android) you
can also use *Install app* to pin it to the home screen / start menu.

> **Serve it, don't double-click it.** Chrome gives `file://` pages an opaque origin where
> `localStorage` is unavailable, so nothing would persist. If storage is blocked the app
> shows a red banner telling you exactly that instead of quietly dropping your records.

## The flow

1. **Clinic name first.** The first screen asks for the clinic name (and optional clinic
   phone). Nothing else is reachable until that is set — it is stored as
   `returnpulse.settings.v1`.
2. **Log a follow-up.** Patient name, phone number, the date they must come back, an
   optional appointment time, department, doctor, notes, status.
3. **Chronological order.** The log is sorted by date + time, earliest first, and grouped
   under sticky day headers: *Overdue → Today → Tomorrow → dated groups → Attended → No-shows*.
4. **Colour code by date *and* time.**
   | Band | Colour | Trigger |
   |---|---|---|
   | Overdue | deep red | date before today, **or** today's slot time already passed |
   | Today | red | due today — escalates to *Due now* inside the 90 min before the slot |
   | Tomorrow | orange | +1 day |
   | Soon | yellow | +2 to +3 days |
   | This week | green | +4 to +7 days |
   | Later | blue | beyond a week |
   | Attended / No-show | muted green / grey | closed out |
5. **Remind.** Every card has a **Remind** button. It opens one of three prefilled
   templates (Gentle reminder / Day-of alert / We missed you), lets you edit it, and sends
   it through WhatsApp (`wa.me`), SMS, or a call — plus one-tap *copy message* and
   *copy number*. Every send is written to that patient's reminder log.
6. **Smart triage.** Each card shows a risk score with the reasons behind it
   (slot passed, no reminder sent yet, department drop-off weight, early-morning slot,
   previous no-shows on that number). It also picks the template that fits the patient.

## Departments

52 departments are wired in, including Cardiology, Cardio-Thoracic Surgery, Physiotherapy,
Orthopaedics, Neurology, Neurosurgery, Nephrology, Dialysis, Urology, Gastroenterology,
Hepatology, Pulmonology, Endocrinology / Diabetology, Rheumatology, Oncology, Haematology,
Dermatology, ENT, Audiology & Speech, Ophthalmology, Dentistry, Oral & Maxillofacial,
Psychiatry, Psychology, Paediatrics, Neonatology, Obstetrics & Gynaecology, Fertility / IVF,
General Medicine, General Surgery, Laparoscopic, Plastic, Vascular, Emergency, Radiology,
Pathology, Nuclear Medicine, Pain Clinic, Geriatrics, Nutrition, Occupational Therapy,
Podiatry, Sports Medicine, Rehabilitation, Infectious Diseases, Immunology / Allergy,
Sleep Clinic, Wound Care, Pharmacy review, Health Check-up, Vaccination and Other.
Edit the list in `DEPARTMENTS` at the top of `app.js`.

## Templates

The three defaults live in `DEFAULT_TEMPLATES` in `app.js` and are editable in
**Templates & settings** (gear icon). Supported merge fields:

```
{{name}} {{clinic}} {{date}} {{time}} {{dept}} {{doctor}} {{phone}} {{days}}
```

Fragments around an empty field (`with {{doctor}}`, `at {{time}}`, `call {{phone}}`) are
dropped automatically so the message never reads "with  at ".

## Storage

| Key | Holds |
|---|---|
| `returnpulse.settings.v1` | clinic name, clinic phone, country code, templates, theme |
| `returnpulse.patients.v1` | the whole follow-up log |

Written on every mutation, immediately, synchronously. The rail shows a *Saved to this
device* flag each time. Because there is no database, clearing browser data wipes the log —
use **Backup / restore** in settings to move between devices.

## Files

```
index.html              markup: onboarding, app shell, patient / remind / settings sheets
styles.css              design tokens, light + dark, mobile-first with a desktop two-pane layout
app.js                  state, localStorage persistence, urgency + triage engines, UI
assets/logo.svg         app icon / logo
assets/logo-mark.svg    wordmark pulse
manifest.webmanifest    installable web-app metadata
package.json            dev dependency (jsdom) + npm scripts
tests/app.test.mjs      jsdom end-to-end checks of the real page
```

## Tests

```bash
npm install            # jsdom is the only dev dependency
npm test
```

The suite loads the actual `index.html` + `app.js` in jsdom and drives the real UI:
onboarding → add a patient → assert it landed in `localStorage` → check colour bands,
ordering, template rendering, WhatsApp links and copy-to-clipboard.

## About the "AI"

The branding says AI-driven. The smart-triage engine behind it is a transparent,
deterministic rule set (`riskOf()` in `app.js`) that runs entirely on the device —
no model, no network call, no patient data leaves the browser.
