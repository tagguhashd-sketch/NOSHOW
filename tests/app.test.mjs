/**
 * End-to-end checks against the real index.html + app.js, driven through jsdom.
 * Nothing here re-implements app logic — every assertion goes through the shipped page.
 *
 * The clock is pinned to Wednesday 14 Oct 2026, 14:30 local — the exact scenario
 * from the brief ("if today is 14 and a patient needs to come on 14 it should come red").
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'index.html'), 'utf8');
const JS = readFileSync(join(ROOT, 'app.js'), 'utf8');

const NOW = new Date(2026, 9, 14, 14, 30, 0);
const pad = (n) => String(n).padStart(2, '0');
const dateAt = (offset) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset);
const key = (offset) => {
  const d = dateAt(offset);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};

const live = [];

async function boot(storage = {}, opts = {}) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    if (!/Could not load|Not implemented|Error: Not implemented/.test(e.message)) throw e;
  });
  const dom = new JSDOM(HTML, {
    // an opaque origin is how Chrome treats file:// — window.localStorage is unavailable
    url: opts.blockStorage ? 'about:blank' : 'http://localhost:8080/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window;

  // Pin the page's clock so "today" is 14 Oct 2026 no matter when the suite runs.
  const RealDate = win.Date;
  const Fixed = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW.getTime()); }
  };
  Fixed.now = () => NOW.getTime();
  Fixed.parse = RealDate.parse;
  Fixed.UTC = RealDate.UTC;
  win.Date = Fixed;

  win.confirm = () => true;
  win.__copied = null;
  win.document.execCommand = function () {
    const tas = win.document.querySelectorAll('textarea');
    win.__copied = tas.length ? tas[tas.length - 1].value : null;
    return true;
  };
  Object.defineProperty(win.navigator, 'clipboard', { value: undefined, configurable: true });

  Object.keys(storage).forEach((k) => win.localStorage.setItem(k, storage[k]));

  win.eval(JS); // the real boot path; init() fires on DOMContentLoaded
  for (let i = 0; i < 400 && !win.RP; i++) await new Promise((r) => win.setTimeout(r, 5));
  assert.ok(win.RP, 'app.js never finished booting');
  live.push(win);
  return { dom, win, doc: win.document, RP: win.RP };
}

after(() => { while (live.length) live.pop().close(); });

/* ── DOM helpers ─────────────────────────────────────────────── */
const $ = (win, id) => win.document.getElementById(id);
const click = (win, el) => {
  assert.ok(el, 'element to click was not found');
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
};
const setVal = (win, id, v) => {
  const el = $(win, id);
  el.value = v;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
};
const submit = (win, id) =>
  $(win, id).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

const passOnboarding = (win, clinic = 'Sunrise Clinic') => {
  setVal(win, 'obClinic', clinic);
  setVal(win, 'obClinicPhone', '+91 98765 00000');
  submit(win, 'obForm');
};

function addPatient(win, { name, phone = '9876543210', date, time = '', dept = 'Cardiology', status = 'scheduled' }) {
  click(win, $(win, 'addBtnRail'));
  setVal(win, 'pName', name);
  setVal(win, 'pPhone', phone);
  setVal(win, 'pDept', dept);
  setVal(win, 'pDate', date);
  setVal(win, 'pTime', time);
  setVal(win, 'pStatus', status);
  submit(win, 'patientForm');
}

const stored = (win) => JSON.parse(win.localStorage.getItem('returnpulse.patients.v1') || '[]');
const cards = (win) => Array.from(win.document.querySelectorAll('#list .card'));
const cardName = (c) => c.querySelector('.card-name').firstChild.textContent.trim();
const dayHeaders = (win) => Array.from(win.document.querySelectorAll('.day-title')).map((h) => h.textContent);

/* ═══════════════════════════════════════════════════════════════ */

describe('boot & onboarding', () => {
  test('asks for the clinic name before anything else', async () => {
    const { win } = await boot();
    assert.equal($(win, 'onboarding').hidden, false, 'onboarding must be visible');
    assert.equal($(win, 'app').hidden, true, 'app must stay hidden until the clinic name is set');
    assert.ok($(win, 'obClinic'), 'clinic name field exists');
    assert.match(win.document.title, /ReturnPulse/);
  });

  test('refuses to continue with an empty clinic name', async () => {
    const { win } = await boot();
    submit(win, 'obForm');
    assert.equal($(win, 'app').hidden, true);
    assert.equal(win.localStorage.getItem('returnpulse.settings.v1'), null);
  });

  test('writes the clinic name to localStorage immediately and reveals the app', async () => {
    const { win } = await boot();
    passOnboarding(win, 'Lakeview Heart & Rehab');
    assert.equal($(win, 'app').hidden, false);
    const s = JSON.parse(win.localStorage.getItem('returnpulse.settings.v1'));
    assert.equal(s.clinic, 'Lakeview Heart & Rehab');
    assert.equal($(win, 'clinicNameLabel').textContent, 'Lakeview Heart & Rehab');
  });

  test('every department is wired into the picker', async () => {
    const { win, RP } = await boot();
    const opts = Array.from($(win, 'pDept').options).map((o) => o.value);
    assert.equal(opts.length, RP.DEPARTMENTS.length);
    assert.ok(opts.length >= 50, 'expected a full department list, got ' + opts.length);
    ['Cardiology', 'Cardio-Thoracic Surgery', 'Physiotherapy', 'Orthopaedics', 'Neurology',
     'Dermatology', 'ENT (Otorhinolaryngology)', 'Ophthalmology', 'Dentistry / Dental Surgery',
     'Psychiatry', 'Obstetrics & Gynaecology', 'Endocrinology / Diabetology',
     'Radiology & Imaging', 'Paediatrics'].forEach((d) =>
      assert.ok(opts.includes(d), 'missing department: ' + d));
    // and into the list filter too
    assert.ok($(win, 'deptFilter').options.length === opts.length + 1);
  });
});

describe('colour coding by date and time', () => {
  let RP;
  before(async () => { RP = (await boot()).RP; });

  test('a patient due on the 14th, when today is the 14th, is RED', async () => {
    const u = RP.urgencyOf({ date: key(0), time: '18:00', status: 'scheduled' });
    assert.equal(u.level, 'today');
    assert.equal(u.tone, 'today');            // → var(--today) = #e01b2c
    assert.match(u.label, /^Today in 3 hr 30 min$/);
  });

  test("today's card escalates as the clock moves toward and past the slot", async () => {
    const imminent = RP.urgencyOf({ date: key(0), time: '15:00', status: 'scheduled' });
    assert.equal(imminent.tone, 'today');
    assert.match(imminent.label, /Due now/);

    const passed = RP.urgencyOf({ date: key(0), time: '09:00', status: 'scheduled' });
    assert.equal(passed.tone, 'overdue');
    assert.match(passed.label, /Slot passed today at 9:00 am/);
  });

  test('the red → orange → yellow → green → blue ladder', async () => {
    const tone = (off) => RP.urgencyOf({ date: key(off), time: '10:00', status: 'scheduled' }).tone;
    assert.equal(tone(-1), 'overdue');   // deep red
    assert.equal(tone(1), 'tomorrow');   // orange
    assert.equal(tone(2), 'soon');       // yellow
    assert.equal(tone(3), 'soon');       // yellow
    assert.equal(tone(4), 'week');       // green
    assert.equal(tone(7), 'week');       // green
    assert.equal(tone(8), 'later');      // blue
    assert.equal(tone(20), 'later');
  });

  test('closed records leave the urgency ladder', async () => {
    assert.equal(RP.urgencyOf({ date: key(0), time: '', status: 'arrived' }).tone, 'done');
    assert.equal(RP.urgencyOf({ date: key(-5), time: '', status: 'noshow' }).tone, 'noshow');
  });

  test('rendered cards actually carry the tone class', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Today Person', date: key(0), time: '19:00' });
    addPatient(win, { name: 'Green Person', date: key(5), time: '11:00' });
    addPatient(win, { name: 'Late Person', date: key(-2), time: '11:00' });
    addPatient(win, { name: 'Yellow Person', date: key(2), time: '11:00' });

    const of = (n) => cards(win).find((c) => c.textContent.includes(n));
    assert.ok(of('Today Person').classList.contains('t-today'), 'due today must be red');
    assert.ok(of('Yellow Person').classList.contains('t-soon'), '+2 days must be yellow');
    assert.ok(of('Green Person').classList.contains('t-week'), '+5 days must be green');
    assert.ok(of('Late Person').classList.contains('t-overdue'), 'past date must be overdue red');
  });
});

describe('chronological ordering', () => {
  test('the log is sorted soonest-first and grouped under day headers', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Zeta Far', date: key(20) });
    addPatient(win, { name: 'Alpha Late', date: key(-3) });
    addPatient(win, { name: 'Mid Today', date: key(0), time: '20:00' });
    addPatient(win, { name: 'Beta Tomorrow', date: key(1), time: '09:00' });

    assert.deepEqual(cards(win).map(cardName), ['Alpha Late', 'Mid Today', 'Beta Tomorrow', 'Zeta Far']);

    const d20 = dateAt(20);
    assert.deepEqual(dayHeaders(win), ['Overdue', 'Today', 'Tomorrow',
      d20.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })]);
  });

  test('within a day, the earlier appointment comes first', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Evening Slot', date: key(2), time: '19:00' });
    addPatient(win, { name: 'Morning Slot', date: key(2), time: '08:30' });
    assert.deepEqual(cards(win).map(cardName), ['Morning Slot', 'Evening Slot']);
  });

  test('attended / no-show records sink below the open ones', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Open Soon', date: key(2) });
    addPatient(win, { name: 'Closed Came', date: key(-1), status: 'arrived' });

    assert.deepEqual(cards(win).map(cardName), ['Open Soon', 'Closed Came']);
    assert.deepEqual(dayHeaders(win).slice(-1), ['Attended']);
  });
});

describe('localStorage persistence', () => {
  test('saving a patient writes it straight to localStorage', async () => {
    const { win } = await boot();
    passOnboarding(win);
    assert.deepEqual(stored(win), []);
    addPatient(win, { name: 'Ramesh K', phone: '9876543210', date: key(0), time: '18:30', dept: 'Physiotherapy' });

    const rows = stored(win);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Ramesh K');
    assert.equal(rows[0].phone, '9876543210');
    assert.equal(rows[0].date, key(0));
    assert.equal(rows[0].time, '18:30');
    assert.equal(rows[0].dept, 'Physiotherapy');
    assert.equal(rows[0].status, 'scheduled');
  });

  test('invalid input is rejected and nothing is stored', async () => {
    const { win } = await boot();
    passOnboarding(win);
    click(win, $(win, 'addBtnRail'));
    setVal(win, 'pName', 'No Phone');
    setVal(win, 'pPhone', '12');
    setVal(win, 'pDate', key(1));
    submit(win, 'patientForm');

    assert.deepEqual(stored(win), []);
    assert.equal($(win, 'patientModal').hidden, false, 'the form must stay open on error');
    assert.equal($(win, 'errPhone').hidden, false);
  });

  test('marking a no-show persists, and deleting removes the row', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Ghost Patient', date: key(0) });
    const id = stored(win)[0].id;

    click(win, win.document.querySelector('[data-set="noshow"][data-id="' + id + '"]'));
    assert.equal(stored(win)[0].status, 'noshow');

    click(win, win.document.querySelector('[data-menu="' + id + '"]'));
    click(win, win.document.querySelector('[data-act="del"]'));
    assert.deepEqual(stored(win), []);
    assert.equal(cards(win).length, 0);
  });

  test('a saved log is restored on a fresh page load', async () => {
    const first = await boot();
    passOnboarding(first.win, 'Persisted Clinic');
    addPatient(first.win, { name: 'Saved Record', date: key(3), time: '09:15' });
    const snapshot = {
      'returnpulse.patients.v1': first.win.localStorage.getItem('returnpulse.patients.v1'),
      'returnpulse.settings.v1': first.win.localStorage.getItem('returnpulse.settings.v1')
    };

    const second = await boot(snapshot); // brand new document, same storage
    assert.equal($(second.win, 'onboarding').hidden, true, 'a returning user skips onboarding');
    assert.equal($(second.win, 'app').hidden, false);
    assert.equal(cards(second.win).length, 1);
    assert.equal(cardName(cards(second.win)[0]), 'Saved Record');
    assert.equal($(second.win, 'clinicNameLabel').textContent, 'Persisted Clinic');
  });
});

describe('remind sheet: templates, links, copy', () => {
  function openRemind(win, overrides = {}) {
    passOnboarding(win);
    addPatient(win, Object.assign({ name: 'Remind Me', phone: '9876543210', date: key(0), time: '18:30', dept: 'Cardiology' }, overrides));
    const id = stored(win)[stored(win).length - 1].id;
    click(win, win.document.querySelector('[data-remind="' + id + '"]'));
    return id;
  }

  test('three prefilled templates are offered and the message is composed', async () => {
    const { win } = await boot();
    openRemind(win);
    const tabs = Array.from(win.document.querySelectorAll('.tmpl-tab'));
    assert.equal(tabs.length, 3);
    assert.deepEqual(tabs.map((t) => t.textContent.replace('✦ suggested', '')),
      ['Gentle reminder', 'Day-of alert', 'We missed you']);

    const msg = $(win, 'remindText').value;
    assert.match(msg, /Remind Me/);
    assert.match(msg, /Sunrise Clinic/);
    assert.match(msg, /Cardiology/);
    assert.match(msg, /6:30 pm/);
    assert.ok(!msg.includes('{{'), 'no unreplaced merge fields: ' + msg);
  });

  test('the send links are live the instant the sheet opens, before any typing', async () => {
    const { win } = await boot();
    openRemind(win);
    // Regression: these hrefs used to be empty until the textarea was edited.
    assert.match($(win, 'sendWa').getAttribute('href'), /^https:\/\/wa\.me\/91/);
    assert.match($(win, 'sendSms').getAttribute('href'), /^sms:\+91/);
    assert.equal($(win, 'sendCall').getAttribute('href'), 'tel:+919876543210');
  });

  test('due today ⇒ the engine suggests the day-of template', async () => {
    const { win } = await boot();
    openRemind(win);
    assert.match(win.document.querySelector('.tmpl-tab.active').textContent, /Day-of alert/);
    assert.match($(win, 'remindAiNote').textContent, /Smart triage \d+% · (High|Medium|Low) risk/);
  });

  test('an overdue patient gets the "we missed you" template', async () => {
    const { win } = await boot();
    openRemind(win, { name: 'Overdue One', date: key(-4), time: '10:00' });
    assert.match(win.document.querySelector('.tmpl-tab.active').textContent, /We missed you/);
  });

  test('a future patient gets the gentle reminder', async () => {
    const { win } = await boot();
    openRemind(win, { name: 'Later One', date: key(5), time: '10:00' });
    assert.match(win.document.querySelector('.tmpl-tab.active').textContent, /Gentle reminder/);
  });

  test('picking another tab re-composes the message', async () => {
    const { win } = await boot();
    openRemind(win);
    const first = $(win, 'remindText').value;
    click(win, win.document.querySelectorAll('.tmpl-tab')[2]);
    const third = $(win, 'remindText').value;
    assert.notEqual(first, third);
    assert.match(third, /could not attend/);
  });

  test('WhatsApp / SMS / call links carry the international number and the message', async () => {
    const { win } = await boot();
    openRemind(win);
    const href = $(win, 'sendWa').getAttribute('href');
    assert.match(href, /^https:\/\/wa\.me\/919876543210\?text=/);
    assert.match(decodeURIComponent(href.split('?text=')[1]), /Remind Me/);
    assert.match($(win, 'sendSms').getAttribute('href'), /^sms:\+919876543210\?&body=/);
    assert.equal($(win, 'sendCall').getAttribute('href'), 'tel:+919876543210');
  });

  test('copy buttons put the number and the message on the clipboard', async () => {
    const { win } = await boot();
    openRemind(win);
    click(win, $(win, 'copyNum'));
    assert.equal(win.__copied, '9876543210');

    click(win, $(win, 'copyMsg'));
    assert.match(win.__copied, /Remind Me/);

    // the number chip on the card itself
    click(win, win.document.querySelector('[data-copy-phone]'));
    assert.equal(win.__copied, '9876543210');
  });

  test('sending logs the reminder and flips the status to reminded', async () => {
    const { win } = await boot();
    const id = openRemind(win);
    click(win, $(win, 'sendWa'));
    await new Promise((r) => setTimeout(r, 400));

    const row = stored(win).find((r) => r.id === id);
    assert.equal(row.reminders.length, 1);
    assert.equal(row.reminders[0].channel, 'WhatsApp');
    assert.equal(row.reminders[0].template, 'Day-of alert');
    assert.equal(row.status, 'reminded');
    assert.match($(win, 'remindHistory').textContent, /Reminder log/);
  });

  test('editing the message updates the send links live', async () => {
    const { win } = await boot();
    openRemind(win);
    setVal(win, 'remindText', 'Custom note for you');
    const href = $(win, 'sendWa').getAttribute('href');
    assert.equal(decodeURIComponent(href.split('?text=')[1]), 'Custom note for you');
    assert.equal($(win, 'msgCount').textContent, String('Custom note for you'.length));
    assert.equal($(win, 'msgParts').textContent, '1');
  });
});

describe('template engine', () => {
  test('drops fragments whose field is empty instead of leaving holes', async () => {
    const { win, RP } = await boot();
    passOnboarding(win, 'Sunrise Clinic');
    const body = 'Hi {{name}}, your {{dept}} review with {{doctor}} at {{clinic}} is on {{date}} at {{time}}. Call {{phone}}.';
    const out = RP.renderTemplate(body, {
      name: 'Ann', dept: 'Physiotherapy', date: key(1), time: '', doctor: '', status: 'scheduled'
    });
    assert.ok(!out.includes('{{'), 'no leftover tokens: ' + out);
    assert.ok(!/with\s+at/.test(out), 'must not read "with  at": ' + out);
    assert.ok(!/ at \./.test(out), 'must not read "at .": ' + out);
    assert.ok(!/\s{2,}/.test(out), 'no double spaces: ' + out);
    assert.match(out, /^Hi Ann, your Physiotherapy review at Sunrise Clinic is on /);
    assert.match(out, /Call \+91 98765 00000\.$/);
  });

  test('{{days}} renders a human phrase', async () => {
    const { win, RP } = await boot();
    const p = (off) => RP.renderTemplate('Due {{days}}.', { name: 'A', date: key(off), status: 'scheduled' });
    assert.equal(p(0), 'Due today.');
    assert.equal(p(1), 'Due tomorrow.');
    assert.equal(p(-1), 'Due yesterday.');
    assert.equal(p(-3), 'Due 3 days ago.');
    assert.equal(p(6), 'Due in 6 days.');
  });

  test('the three shipped defaults are intact and editable in settings', async () => {
    const { win, RP } = await boot();
    passOnboarding(win);
    assert.equal(RP.DEFAULT_TEMPLATES.length, 3);
    RP.DEFAULT_TEMPLATES.forEach((t) => assert.match(t.body, /\{\{name\}\}/));

    click(win, $(win, 'openSettings'));
    assert.equal(win.document.querySelectorAll('[data-tmpl-body]').length, 3);
    setVal(win, 'sClinic', 'Renamed Clinic');
    assert.equal(JSON.parse(win.localStorage.getItem('returnpulse.settings.v1')).clinic, 'Renamed Clinic');
    assert.equal($(win, 'clinicNameLabel').textContent, 'Renamed Clinic');
  });
});

describe('smart triage score', () => {
  test('overdue + never reminded scores high; a far-off slot scores low', async () => {
    const { RP } = await boot();
    const hot = RP.riskOf({ id: 'a', name: 'A', phone: '111', date: key(-3), time: '10:00', dept: 'Psychiatry', status: 'scheduled', reminders: [] }, []);
    const cold = RP.riskOf({ id: 'b', name: 'B', phone: '222', date: key(25), time: '11:00', dept: 'Vaccination', status: 'scheduled', reminders: [] }, []);

    assert.equal(hot.band, 'High');
    assert.ok(hot.score >= 70, 'expected high, got ' + hot.score);
    assert.ok(hot.reasons.length > 0, 'the score must explain itself');
    assert.equal(cold.band, 'Low');
    assert.ok(cold.score < 40, 'expected low, got ' + cold.score);
  });

  test('previous no-shows on the same number raise the score', async () => {
    const { RP } = await boot();
    const base = { id: 'x', name: 'X', phone: '9876500000', date: key(2), time: '11:00', dept: 'Physiotherapy', status: 'scheduled', reminders: [] };
    const history = [
      { id: 'h1', phone: '9876500000', status: 'noshow', date: key(-10) },
      { id: 'h2', phone: '9876500000', status: 'noshow', date: key(-20) }
    ];
    const clean = RP.riskOf(base, [base]).score;
    const dirty = RP.riskOf(base, [base].concat(history)).score;
    assert.ok(dirty > clean, dirty + ' should exceed ' + clean);
    assert.match(RP.riskOf(base, [base].concat(history)).reasons.join(' '), /previous no-shows/);
  });

  test('the risk badge and its reasons are shown on the card', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Risky One', date: key(-2), time: '08:00', dept: 'Psychiatry' });
    const label = win.document.querySelector('.risk-label');
    assert.match(label.textContent, /\d+% (High|Medium|Low)/);
    assert.ok(Number(label.textContent.match(/(\d+)%/)[1]) >= 70, 'an overdue, never-reminded slot should be high risk');
    assert.match(win.document.querySelector('.risk').getAttribute('title'), /slot already passed/);
  });
});

describe('phone handling', () => {
  test('a bare 10-digit number gets the default country code for messaging', async () => {
    const { RP } = await boot();
    assert.equal(RP.toIntl('98765 43210', '91'), '919876543210');
    assert.equal(RP.toIntl('+1 (415) 555-0123', '91'), '14155550123');
    assert.equal(RP.toIntl('00971501234567', '91'), '971501234567');
    assert.equal(RP.toIntl('', '91'), '');
  });
});

describe('filters, search and the triage summary', () => {
  test('stat tiles filter the list, and resetting restores it', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Due Today', date: key(0), time: '19:00' });
    addPatient(win, { name: 'Way Later', date: key(30) });
    addPatient(win, { name: 'Slipped', date: key(-1) });

    assert.equal(cards(win).length, 3);
    assert.match($(win, 'aiBar').textContent, /1 follow-up due today/);
    assert.match($(win, 'aiBar').textContent, /1 overdue/);

    click(win, win.document.querySelector('[data-stat="today"]'));
    assert.equal(cards(win).length, 1);
    assert.equal(cardName(cards(win)[0]), 'Due Today');

    click(win, win.document.querySelector('[data-stat="overdue"]'));
    assert.equal(cardName(cards(win)[0]), 'Slipped');

    setVal(win, 'search', 'way later');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(cards(win).length, 0, 'search + overdue filter together match nothing');

    click(win, $(win, 'clearFilters'));
    assert.equal(cards(win).length, 3);
    assert.equal($(win, 'search').value, '');
  });

  test('the department filter narrows the log', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Heart One', date: key(1), dept: 'Cardiology' });
    addPatient(win, { name: 'Physio One', date: key(2), dept: 'Physiotherapy' });

    setVal(win, 'deptFilter', 'Physiotherapy');
    assert.equal(cards(win).length, 1);
    assert.equal(cardName(cards(win)[0]), 'Physio One');
    setVal(win, 'deptFilter', '');
    assert.equal(cards(win).length, 2);
  });

  test('the high-risk tile counts only genuinely risky rows', async () => {
    const { win } = await boot();
    passOnboarding(win);
    addPatient(win, { name: 'Hot', date: key(-2), time: '08:00', dept: 'Psychiatry' });
    addPatient(win, { name: 'Cold', date: key(28), time: '11:00', dept: 'Vaccination' });

    const riskTile = Array.from(win.document.querySelectorAll('.stat'))
      .find((s) => s.textContent.includes('High risk'));
    assert.equal(riskTile.querySelector('.stat-num').textContent, '1');

    click(win, riskTile);
    assert.deepEqual(cards(win).map(cardName), ['Hot']);
  });
});

describe('when the browser blocks storage', () => {
  test('the app says so instead of silently losing records', async () => {
    const { win, RP } = await boot({}, { blockStorage: true });
    assert.equal(RP.storageAvailable(), false);
    assert.equal($(win, 'storageWarn').hidden, false, 'the warning bar must be visible');
    assert.match($(win, 'storageWarn').textContent, /blocking local storage/);
    assert.match($(win, 'storageWarn').textContent, /http/);
  });

  test('storage works normally when served over http', async () => {
    const { win, RP } = await boot();
    assert.equal(RP.storageAvailable(), true);
    assert.equal($(win, 'storageWarn').hidden, true);
  });
});

describe('sample log', () => {
  test('"Load sample log" seeds a full demo straight into localStorage', async () => {
    const { win } = await boot();
    click(win, $(win, 'obDemo'));
    const rows = stored(win);
    assert.ok(rows.length >= 8, 'expected a populated demo log, got ' + rows.length);
    assert.ok(rows.every((r) => r.name && r.phone && r.date && r.dept));
    assert.equal(JSON.parse(win.localStorage.getItem('returnpulse.settings.v1')).clinic,
      'Sunrise Multi-Speciality Clinic');
    assert.equal($(win, 'app').hidden, false);
    // the demo spans every colour band
    const tones = new Set(cards(win).map((c) => Array.from(c.classList).find((x) => x.startsWith('t-'))));
    ['t-overdue', 't-today', 't-tomorrow', 't-soon', 't-week', 't-later', 't-noshow'].forEach((t) =>
      assert.ok(tones.has(t), 'demo log should contain a ' + t + ' card'));
  });
});

describe('empty states', () => {
  test('a brand-new clinic sees a helpful empty log', async () => {
    const { win } = await boot();
    passOnboarding(win);
    assert.equal($(win, 'empty').hidden, false);
    assert.match($(win, 'empty').textContent, /follow-up log is empty/);
    assert.match($(win, 'aiBar').textContent, /Smart triage ready/);
  });
});
