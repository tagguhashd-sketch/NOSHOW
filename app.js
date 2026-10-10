/* ══════════════════════════════════════════════════════════════════
   ReturnPulse — on-device follow-up & no-show reminder desk
   No database. Everything persists to this browser's localStorage.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ───────────────────────── constants ───────────────────────── */

  const K_SETTINGS = 'returnpulse.settings.v1';
  const K_PATIENTS = 'returnpulse.patients.v1';

  const DEPARTMENTS = [
    'Cardiology', 'Cardio-Thoracic Surgery', 'Physiotherapy', 'Orthopaedics', 'Neurology', 'Neurosurgery',
    'Nephrology', 'Dialysis', 'Urology', 'Gastroenterology', 'Hepatology', 'Pulmonology',
    'Endocrinology / Diabetology', 'Rheumatology', 'Oncology', 'Haematology', 'Dermatology',
    'ENT (Otorhinolaryngology)', 'Audiology & Speech', 'Ophthalmology', 'Dentistry / Dental Surgery',
    'Oral & Maxillofacial Surgery', 'Psychiatry', 'Psychology / Counselling', 'Paediatrics', 'Neonatology',
    'Obstetrics & Gynaecology', 'Fertility / IVF', 'General Medicine', 'General Surgery',
    'Laparoscopic Surgery', 'Plastic Surgery', 'Vascular Surgery', 'Emergency / Casualty',
    'Radiology & Imaging', 'Pathology / Lab', 'Nuclear Medicine', 'Anaesthesia / Pain Clinic',
    'Geriatrics', 'Nutrition & Dietetics', 'Occupational Therapy', 'Podiatry', 'Sports Medicine',
    'Rehabilitation', 'Infectious Diseases', 'Immunology / Allergy', 'Sleep Clinic', 'Wound Care',
    'Pharmacy / Medication Review', 'Health Check-up', 'Vaccination', 'Other'
  ];

  // Departments with a statistically higher follow-up drop-off weight.
  const DEPT_RISK = {
    'Psychiatry': 12, 'Psychology / Counselling': 12, 'Dermatology': 10, 'Dentistry / Dental Surgery': 10,
    'Nutrition & Dietetics': 10, 'Physiotherapy': 9, 'Fertility / IVF': 9, 'Occupational Therapy': 9,
    'Sleep Clinic': 9, 'Podiatry': 8, 'Cardiology': 8, 'Endocrinology / Diabetology': 8,
    'Orthopaedics': 7, 'Oncology': 7, 'Nephrology': 7, 'Audiology & Speech': 7, 'Ophthalmology': 6,
    'Gastroenterology': 6, 'ENT (Otorhinolaryngology)': 6, 'Health Check-up': 6, 'Vaccination': 2,
    'Pathology / Lab': 2, 'Radiology & Imaging': 3, 'Emergency / Casualty': 1
  };

  const DEFAULT_TEMPLATES = [
    {
      id: 'gentle',
      name: 'Gentle reminder',
      body: 'Hi {{name}}, this is a friendly reminder from {{clinic}} that your {{dept}} follow-up with {{doctor}} is on {{date}} at {{time}}. Kindly arrive 10 minutes early and carry your previous reports and prescriptions. Need to change the slot? Call {{phone}}. Thank you!'
    },
    {
      id: 'today',
      name: 'Day-of alert',
      body: 'Hi {{name}}, your {{dept}} appointment at {{clinic}} is TODAY, {{date}} at {{time}}. Your slot is reserved and waiting. If you cannot make it, please call {{phone}} so we can offer the time to another patient.'
    },
    {
      id: 'overdue',
      name: 'We missed you',
      body: 'Hi {{name}}, we noticed you could not attend your {{dept}} follow-up at {{clinic}} scheduled for {{date}}. Your reports are still due for review and an early check-up helps avoid complications. Please call {{phone}} to book a new slot this week.'
    }
  ];

  const ICONS = {
    bell: '<path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 01-3.4 0"/>',
    spark: '<path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16.5l-1.9-5.6L4.5 9l5.6-1.4L12 2z"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a12 12 0 005 5L15 12l5 2v4a2 2 0 01-2 2A16 16 0 013 5a2 2 0 012-2z"/>',
    edit: '<path d="M4 20h4l10.5-10.5a2.1 2.1 0 00-3-3L5 17v3z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    dots: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alert: '<path d="M12 3l9 16H3l9-16z"/><path d="M12 9v4m0 3h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 11h18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'
  };
  function svg(name, cls) {
    const filled = name === 'spark' || name === 'dots';
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"' +
      (filled ? ' fill="currentColor" stroke="none"' : '') + '>' + (ICONS[name] || '') + '</svg>';
  }

  /* ───────────────────────── state ───────────────────────── */

  const $ = function (id) { return document.getElementById(id); };
  const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  let settings = null;
  let patients = [];
  let ui = {
    filter: 'all',
    dept: '',
    q: '',
    sort: 'date-asc',
    theme: 'light',
    editingId: null,
    remindId: null,
    tmplId: null,
    menuFor: null
  };

  /* ───────────────────────── pure helpers ───────────────────────── */

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function toKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function startOfDay(d) { const x = new Date(d.getTime()); x.setHours(0, 0, 0, 0); return x; }
  function parseKey(k) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ''));
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  /** Whole-calendar-day difference of a YYYY-MM-DD key from `now`. */
  function daysFrom(key, now) {
    const d = parseKey(key);
    if (!d) return 0;
    return Math.round((startOfDay(d) - startOfDay(now || new Date())) / 86400000);
  }
  function fmtDate(key, opts) {
    const d = parseKey(key);
    if (!d) return key || '';
    return d.toLocaleDateString(undefined, opts || { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtTime(t) {
    if (!t) return '';
    const m = /^(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return t;
    let h = Number(m[1]); const mm = m[2];
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + mm + ' ' + ap;
  }
  function minutesOf(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function humanDuration(mins) {
    const a = Math.abs(mins);
    const h = Math.floor(a / 60), m = a % 60;
    if (h === 0) return m + ' min';
    if (m === 0) return h + ' hr';
    return h + ' hr ' + m + ' min';
  }

  function digits(s) { return String(s || '').replace(/\D/g, ''); }

  /** International form used for wa.me / tel / sms links. */
  function toIntl(phone, cc) {
    let d = digits(phone);
    const c = digits(cc || '');
    if (!d) return '';
    if (d.indexOf('00') === 0) d = d.slice(2);
    else if (c && d.length <= 10) d = c + d.replace(/^0+/, '');
    return d;
  }
  /** Pretty form of the number the user typed (falls back to the intl form). */
  function prettyPhone(phone, cc) {
    const raw = String(phone || '').trim();
    if (raw) return raw;
    const i = toIntl(phone, cc);
    return i ? '+' + i : '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /* ─────────── urgency: colour code from date + time ─────────── */

  /**
   * Colour band for a patient, driven by the calendar gap AND the clock.
   * tone → overdue (deep red) · today (red) · tomorrow (orange) · soon (yellow)
   *        · week (green) · later (blue) · done · noshow
   */
  function urgencyOf(p, now) {
    now = now || new Date();
    const diff = daysFrom(p.date, now);
    const when = fmtDate(p.date) + (p.time ? ' · ' + fmtTime(p.time) : '');

    if (p.status === 'arrived') {
      return { level: 'done', tone: 'done', closed: true, label: 'Attended', sub: when, diff: diff };
    }
    if (p.status === 'noshow') {
      return { level: 'noshow', tone: 'noshow', closed: true, label: 'No-show', sub: when, diff: diff };
    }
    if (diff < 0) {
      const n = Math.abs(diff);
      return {
        level: 'overdue', tone: 'overdue', closed: false,
        label: 'Overdue by ' + n + (n === 1 ? ' day' : ' days'), sub: when, diff: diff
      };
    }
    if (diff === 0) {
      const mins = minutesOf(p.time);
      if (mins !== null) {
        const nowMins = now.getHours() * 60 + now.getMinutes();
        if (nowMins > mins + 30) {
          return { level: 'overdue', tone: 'overdue', closed: false, label: 'Slot passed today at ' + fmtTime(p.time), sub: when, diff: 0 };
        }
        if (nowMins >= mins - 90) {
          return { level: 'today', tone: 'today', closed: false, label: 'Due now · ' + fmtTime(p.time), sub: when, diff: 0 };
        }
        return { level: 'today', tone: 'today', closed: false, label: 'Today in ' + humanDuration(mins - nowMins), sub: when, diff: 0 };
      }
      return { level: 'today', tone: 'today', closed: false, label: 'Due today', sub: when, diff: 0 };
    }
    if (diff === 1) return { level: 'tomorrow', tone: 'tomorrow', closed: false, label: 'Tomorrow', sub: when, diff: 1 };
    if (diff <= 3) return { level: 'soon', tone: 'soon', closed: false, label: 'In ' + diff + ' days', sub: when, diff: diff };
    if (diff <= 7) return { level: 'week', tone: 'week', closed: false, label: 'In ' + diff + ' days', sub: when, diff: diff };
    return { level: 'later', tone: 'later', closed: false, label: 'In ' + diff + ' days', sub: when, diff: diff };
  }

  /* ─────────── "AI" smart-triage score (deterministic rules) ─────────── */

  function riskOf(p, all, now) {
    all = all || patients;
    now = now || new Date();
    const u = urgencyOf(p, now);
    const reasons = [];
    let s = 0;

    if (u.level === 'overdue') { s += 48; reasons.push('slot already passed'); }
    else if (u.level === 'today') { s += 32; reasons.push('due today'); }
    else if (u.level === 'tomorrow') { s += 22; reasons.push('due tomorrow'); }
    else if (u.level === 'soon') { s += 13; reasons.push('due in ' + u.diff + ' days'); }
    else if (u.level === 'week') { s += 7; }
    else if (u.level === 'later') { s += 4; }

    const dw = DEPT_RISK[p.dept] != null ? DEPT_RISK[p.dept] : 5;
    s += dw;
    if (dw >= 9) reasons.push(p.dept + ' follow-ups often drop off');

    const mins = minutesOf(p.time);
    if (mins !== null) {
      if (mins < 9 * 60) { s += 7; reasons.push('early-morning slot'); }
      else if (mins >= 13 * 60 && mins < 15 * 60) { s += 4; reasons.push('post-lunch slot'); }
      else if (mins >= 18 * 60) { s += 5; reasons.push('late-evening slot'); }
    }

    const history = all.filter(function (x) {
      return x.id !== p.id && digits(x.phone) === digits(p.phone) && x.status === 'noshow';
    }).length;
    if (history) { s += Math.min(26, history * 13); reasons.push(history === 1 ? '1 previous no-show on this number' : history + ' previous no-shows on this number'); }

    const sent = (p.reminders || []).length;
    if (sent && p.status !== 'reminded') { s += 6; reasons.push('reminder sent, no confirmation'); }
    // No reminder yet and the slot is already here (or gone) — the classic no-show setup.
    if (!sent && !u.closed && u.diff <= 2) { s += 12; reasons.push('no reminder sent yet'); }

    if (u.closed) s = Math.min(s, 12);

    s = Math.max(2, Math.min(99, s));
    const band = s >= 70 ? 'High' : s >= 40 ? 'Medium' : 'Low';
    return { score: s, band: band, reasons: reasons };
  }

  /** Which of the three templates the engine prefers for this patient. */
  function suggestedTemplate(p, now) {
    const u = urgencyOf(p, now || new Date());
    if (u.level === 'overdue') return 'overdue';
    if (u.level === 'today') return 'today';
    return 'gentle';
  }

  /* ─────────── message rendering ─────────── */

  function daysPhrase(diff) {
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff === -1) return 'yesterday';
    if (diff < 0) return Math.abs(diff) + ' days ago';
    return 'in ' + diff + ' days';
  }

  function renderTemplate(body, p, now) {
    now = now || new Date();
    const s = settings || {};
    const diff = daysFrom(p.date, now);
    let out = String(body || '');

    // Drop optional fragments when the clinic did not fill those fields in.
    if (!p.doctor) out = out.replace(/\s*(?:with|by)\s*\{\{doctor\}\}/gi, '');
    if (!p.time) out = out.replace(/\s*(?:at|@)\s*\{\{time\}\}/gi, '');
    if (!s.clinicPhone) out = out.replace(/\s*(?:call|contact)\s*\{\{phone\}\}/gi, '');
    if (!s.clinic) out = out.replace(/\s*(?:from|at)\s*\{\{clinic\}\}/gi, '');

    const map = {
      name: p.name, clinic: s.clinic || 'our clinic',
      date: fmtDate(p.date, { weekday: 'long', day: 'numeric', month: 'long' }),
      time: p.time ? fmtTime(p.time) : '', dept: p.dept || 'follow-up',
      doctor: p.doctor || '', phone: s.clinicPhone || '', days: daysPhrase(diff)
    };
    out = out.replace(/\{\{\s*(\w+)\s*\}\}/g, function (m, k) {
      return map[k] != null ? String(map[k]) : '';
    });
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  }

  /* ───────────────────────── persistence ───────────────────────── */

  /** Chrome hands out an opaque origin for file:// URLs, where storage silently fails. */
  function storageAvailable() {
    try {
      const k = '__returnpulse_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }
  function flagStorageBlocked() {
    const el = $('storageWarn');
    if (el) el.hidden = false;
  }

  function flashSaved() {
    const el = $('saveFlag');
    if (!el) return;
    el.classList.add('flash');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function () { el.classList.remove('flash'); }, 1400);
  }

  function savePatients() {
    try {
      localStorage.setItem(K_PATIENTS, JSON.stringify(patients));
      flashSaved();
    } catch (e) {
      flagStorageBlocked();
      toast('Could not save — browser storage is full or blocked.', 'err');
    }
  }
  function saveSettings() {
    try {
      localStorage.setItem(K_SETTINGS, JSON.stringify(settings));
      flashSaved();
    } catch (e) { /* non fatal */ }
  }
  function loadAll() {
    let s = null, p = [];
    try { s = JSON.parse(localStorage.getItem(K_SETTINGS) || 'null'); } catch (e) { s = null; }
    try {
      const raw = JSON.parse(localStorage.getItem(K_PATIENTS) || '[]');
      if (Array.isArray(raw)) p = raw;
    } catch (e) { p = []; }

    settings = Object.assign({
      clinic: '', clinicPhone: '', countryCode: '91',
      templates: DEFAULT_TEMPLATES.map(function (t) { return Object.assign({}, t); }),
      theme: 'light'
    }, s || {});
    if (!Array.isArray(settings.templates) || !settings.templates.length) {
      settings.templates = DEFAULT_TEMPLATES.map(function (t) { return Object.assign({}, t); });
    }
    patients = p.filter(function (x) { return x && x.name && x.date; }).map(normaliseRecord);
  }
  function normaliseRecord(r) {
    return {
      id: r.id || uid(),
      name: String(r.name || '').trim(),
      phone: String(r.phone || '').trim(),
      date: String(r.date || ''),
      time: r.time || '',
      dept: r.dept || 'Other',
      doctor: r.doctor || '',
      note: r.note || '',
      status: ['scheduled', 'reminded', 'arrived', 'noshow'].indexOf(r.status) >= 0 ? r.status : 'scheduled',
      reminders: Array.isArray(r.reminders) ? r.reminders : [],
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: r.updatedAt || new Date().toISOString()
    };
  }

  /* ───────────────────────── toasts ───────────────────────── */

  function toast(msg, kind) {
    const wrap = $('toasts');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'ok');
    el.innerHTML = svg(kind === 'err' ? 'alert' : 'check') + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }, 2600);
  }

  async function copyText(text, label) {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch (e) { ok = false; }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) { ok = false; }
    }
    toast(ok ? (label || 'Copied') + ' copied to clipboard' : 'Copy failed — select and copy manually', ok ? 'ok' : 'err');
    return ok;
  }

  /* ───────────────────────── derived data ───────────────────────── */

  function matches(p) {
    if (ui.dept && p.dept !== ui.dept) return false;
    if (ui.q) {
      const q = ui.q.toLowerCase();
      const hay = (p.name + ' ' + p.phone + ' ' + p.dept + ' ' + (p.doctor || '') + ' ' + (p.note || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    const u = urgencyOf(p);
    switch (ui.filter) {
      case 'overdue': return u.level === 'overdue';
      case 'today': return u.level === 'today';
      case 'tomorrow': return u.level === 'tomorrow';
      case 'week': return u.diff >= 0 && u.diff <= 7 && !u.closed;
      case 'noshow': return p.status === 'noshow';
      case 'risk': return riskOf(p).score >= 70;
      case 'all': return true;
      default: return true;
    }
  }

  function sortList(list) {
    const key = function (p) { return p.date + 'T' + (p.time || '00:00'); };
    const byDateAsc = function (a, b) { return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0; };
    const byDateDesc = function (a, b) { return -byDateAsc(a, b); };
    switch (ui.sort) {
      case 'date-desc': return list.sort(byDateDesc);
      case 'name-asc': return list.sort(function (a, b) { return a.name.localeCompare(b.name); });
      case 'created-desc': return list.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
      case 'risk-desc': return list.sort(function (a, b) { return riskOf(b).score - riskOf(a).score || byDateAsc(a, b); });
      default: return list.sort(byDateAsc);
    }
  }

  function groupKey(p) {
    if (p.status === 'arrived') return 'z-done';
    if (p.status === 'noshow') return 'z-noshow';
    const d = daysFrom(p.date);
    const u = urgencyOf(p);
    if (u.level === 'overdue') return 'a-overdue';
    if (d === 0) return 'b-today';
    if (d === 1) return 'c-tomorrow';
    return p.date;
  }
  const GROUP_LABEL = {
    'a-overdue': { t: 'Overdue', tone: 'overdue' },
    'b-today': { t: 'Today', tone: 'today' },
    'c-tomorrow': { t: 'Tomorrow', tone: 'tomorrow' },
    'z-done': { t: 'Attended', tone: 'done' },
    'z-noshow': { t: 'No-shows', tone: 'noshow' }
  };

  /* ───────────────────────── rendering ───────────────────────── */

  function renderStats() {
    const now = new Date();
    const c = { overdue: 0, today: 0, week: 0, risk: 0 };
    patients.forEach(function (p) {
      const u = urgencyOf(p, now);
      if (u.closed) return;
      if (u.level === 'overdue') c.overdue++;
      if (u.level === 'today') c.today++;
      if (u.diff >= 0 && u.diff <= 7) c.week++;
      if (riskOf(p).score >= 70) c.risk++;
    });
    const tiles = [
      { id: 'today', n: c.today, l: 'Due today', cls: 's-today' },
      { id: 'overdue', n: c.overdue, l: 'Overdue', cls: 's-overdue' },
      { id: 'week', n: c.week, l: 'Next 7 days', cls: 's-week' },
      { id: 'risk', n: c.risk, l: 'High risk', cls: 's-risk' }
    ];
    $('stats').innerHTML = tiles.map(function (t) {
      return '<button class="stat ' + t.cls + (ui.filter === t.id ? ' active' : '') + '" data-stat="' + t.id + '" type="button">' +
        '<div class="stat-num">' + t.n + '</div><div class="stat-label">' + t.l + '</div></button>';
    }).join('');
  }

  function renderChips() {
    const now = new Date();
    const counts = { all: patients.length, overdue: 0, today: 0, tomorrow: 0, week: 0, noshow: 0, risk: 0 };
    patients.forEach(function (p) {
      const u = urgencyOf(p, now);
      if (p.status === 'noshow') counts.noshow++;
      if (u.closed) return;
      if (u.level === 'overdue') counts.overdue++;
      if (u.level === 'today') counts.today++;
      if (u.level === 'tomorrow') counts.tomorrow++;
      if (u.diff >= 0 && u.diff <= 7) counts.week++;
      if (riskOf(p).score >= 70) counts.risk++;
    });
    const chips = [
      ['all', 'All'], ['overdue', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'],
      ['week', '7 days'], ['risk', 'High risk'], ['noshow', 'No-shows']
    ];
    $('filterChips').innerHTML = chips.map(function (c) {
      return '<button class="chip' + (ui.filter === c[0] ? ' active' : '') + '" data-filter="' + c[0] + '" type="button">' +
        c[1] + '<span class="cnt">' + counts[c[0]] + '</span></button>';
    }).join('');
    $('clearFilters').hidden = !(ui.filter !== 'all' || ui.dept || ui.q);
  }

  function renderAiBar() {
    const now = new Date();
    const due = patients.filter(function (p) { return urgencyOf(p, now).level === 'today' && !urgencyOf(p, now).closed; });
    const od = patients.filter(function (p) { return urgencyOf(p, now).level === 'overdue'; });
    const unreminded = patients.filter(function (p) {
      const u = urgencyOf(p, now);
      return !u.closed && u.diff <= 1 && !(p.reminders || []).length;
    });
    const parts = [];
    if (due.length) parts.push('<b>' + due.length + '</b> follow-up' + (due.length > 1 ? 's' : '') + ' due today');
    if (od.length) parts.push('<b>' + od.length + '</b> overdue');
    if (!patients.length) {
      $('aiBar').innerHTML = svg('spark') + '<div><b>Smart triage ready.</b> Add your first follow-up and ReturnPulse will colour-code it by date and time, then draft the reminder for you.</div>';
      return;
    }
    let line = parts.length ? 'Right now ' + parts.join(' and ') + '.' : 'Nothing urgent in the log — next follow-up is ' + fmtDate(sortList(patients.slice())[0].date) + '.';
    if (unreminded.length) {
      line += ' <b>' + unreminded.length + '</b> patient' + (unreminded.length > 1 ? 's' : '') + ' due within a day have not been reminded yet — those are the ones most likely to no-show.';
    }
    $('aiBar').innerHTML = svg('spark') + '<div>' + line + '</div>';
  }

  function cardHTML(p) {
    const now = new Date();
    const u = urgencyOf(p, now);
    const r = riskOf(p, patients, now);
    const intl = toIntl(p.phone, settings.countryCode);

    const flags = [];
    if (p.status === 'reminded') flags.push('<span class="flag">Reminded</span>');
    if (p.status === 'arrived') flags.push('<span class="flag">Attended</span>');
    if (p.status === 'noshow') flags.push('<span class="flag">No-show</span>');

    const meta = [];
    meta.push('<span class="dept-tag">' + esc(p.dept) + '</span>');
    meta.push('<span>' + svg('calendar', 'ico-sm') + ' ' + esc(fmtDate(p.date)) + (p.time ? ' · ' + esc(fmtTime(p.time)) : '') + '</span>');
    if (p.doctor) meta.push('<span>' + esc(p.doctor) + '</span>');
    if (p.phone) {
      meta.push('<button class="card-phone" data-copy-phone="' + esc(p.id) + '" type="button" title="Copy number">' +
        svg('copy', 'ico-sm') + esc(prettyPhone(p.phone, settings.countryCode)) + '</button>');
    }

    return '' +
      '<article class="card t-' + u.tone + (u.closed ? ' is-closed' : '') + '" data-id="' + esc(p.id) + '">' +
        '<div class="card-bar"></div>' +
        '<div class="card-body">' +
          '<div class="card-top">' +
            '<div class="card-id">' +
              '<div class="card-name">' + esc(p.name) + flags.join('') + '</div>' +
              '<div class="card-meta">' + meta.join('<span class="sep">·</span>') + '</div>' +
              (p.note ? '<div class="card-note">' + esc(p.note) + '</div>' : '') +
            '</div>' +
            '<div class="card-actions">' +
              '<button class="act primary" data-remind="' + esc(p.id) + '" type="button">' + svg('bell', 'ico-sm') + '<span>Remind</span></button>' +
              '<a class="act icon" href="tel:' + esc(intl) + '" title="Call ' + esc(prettyPhone(p.phone, settings.countryCode)) + '" aria-label="Call">' + svg('phone', 'ico-sm') + '</a>' +
              '<button class="act icon" data-menu="' + esc(p.id) + '" type="button" title="More" aria-label="More actions">' + svg('dots', 'ico-sm') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="card-foot">' +
            '<span class="urgency">' + svg(u.level === 'overdue' ? 'alert' : 'clock', 'ico-sm') + esc(u.label) + '</span>' +
            '<span class="status-pill">' + esc(u.sub) + '</span>' +
            (u.closed ? '' :
              '<span class="quick-set">' +
                '<button class="mini' + (p.status === 'arrived' ? ' on-arrived' : '') + '" data-set="arrived" data-id="' + esc(p.id) + '" type="button">Attended</button>' +
                '<button class="mini' + (p.status === 'noshow' ? ' on-noshow' : '') + '" data-set="noshow" data-id="' + esc(p.id) + '" type="button">No-show</button>' +
              '</span>') +
            '<span class="risk" title="' + esc(r.reasons.join(' · ') || 'Smart triage score') + '">' +
              '<span class="risk-label">' + svg('spark') + r.score + '% ' + r.band + '</span>' +
              '<span class="risk-bar"><span class="risk-fill" style="width:' + r.score + '%"></span></span>' +
            '</span>' +
          '</div>' +
        '</div>' +
      '</article>';
  }

  function renderList() {
    const now = new Date();
    const matched = sortList(patients.filter(matches));
    // Chronological order for open follow-ups; closed ones (attended / no-show) sink below.
    const list = matched.filter(function (p) { return !urgencyOf(p, now).closed; })
      .concat(matched.filter(function (p) { return urgencyOf(p, now).closed; }));
    const listEl = $('list');
    const emptyEl = $('empty');

    if (!patients.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      emptyEl.innerHTML = '<img src="assets/logo.svg" alt="" />' +
        '<h3>Your follow-up log is empty</h3>' +
        '<p>Add a patient with their phone number, department and the date they must return. ' +
        'ReturnPulse colour-codes every entry by how close it is to today and drafts the reminder for you.</p>' +
        '<button class="btn btn-primary" id="emptyAdd" type="button">' + svg('bell') + ' Add the first follow-up</button>';
      return;
    }
    if (!list.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      emptyEl.innerHTML = '<h3>Nothing matches this filter</h3>' +
        '<p>Try another tab, clear the search box, or pick “All departments”.</p>' +
        '<button class="btn btn-ghost" id="emptyReset" type="button">Reset filters</button>';
      return;
    }
    emptyEl.hidden = true;

    // Chronological order, grouped by day, with sticky day headers.
    const groups = [];
    const index = {};
    list.forEach(function (p) {
      const k = groupKey(p);
      if (index[k] === undefined) { index[k] = groups.length; groups.push({ key: k, items: [] }); }
      groups[index[k]].items.push(p);
    });

    let html = '';
    groups.forEach(function (g) {
      const preset = GROUP_LABEL[g.key];
      let title, sub = '', tone;
      if (preset) { title = preset.t; tone = preset.tone; }
      else {
        const d = parseKey(g.key);
        const diff = daysFrom(g.key, now);
        title = fmtDate(g.key, { weekday: 'long', day: 'numeric', month: 'short' });
        sub = diff + ' days from today';
        tone = urgencyOf({ date: g.key, time: '', status: 'scheduled' }, now).tone;
      }
      html += '<div class="day-head h-' + tone + '">' +
        '<span class="day-title">' + esc(title) + '</span>' +
        (sub ? '<span class="day-sub">' + esc(sub) + '</span>' : '') +
        '<span class="day-count">' + g.items.length + '</span></div>';
      html += g.items.map(cardHTML).join('');
    });
    listEl.innerHTML = html;
  }

  function render() {
    $('clinicNameLabel').textContent = settings.clinic || 'Clinic';
    renderStats();
    renderChips();
    renderAiBar();
    renderList();
  }

  /* ───────────────────────── modal plumbing ───────────────────────── */

  function openModal(id) {
    const m = $(id);
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    const first = m.querySelector('input:not([type=hidden]), select, textarea, button.btn-primary');
    if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 60);
  }
  function closeModal(id) {
    $(id).hidden = true;
    document.body.style.overflow = '';
    closeMenu();
  }

  /* ───────────────────────── patient form ───────────────────────── */

  function fillSelects() {
    const opts = DEPARTMENTS.map(function (d) { return '<option value="' + esc(d) + '">' + esc(d) + '</option>'; }).join('');
    $('pDept').innerHTML = opts;
    $('deptFilter').innerHTML = '<option value="">All departments</option>' + opts;
  }

  function openPatientForm(id) {
    ui.editingId = id || null;
    const f = $('patientForm');
    f.reset();
    $$('.field').forEach(function (x) { x.classList.remove('invalid'); });
    $$('[id^=err]').forEach(function (x) { x.hidden = true; });
    $('phonePreview').textContent = '';
    $('dateHint').textContent = '';
    $('formAiNote').innerHTML = '';

    if (id) {
      const p = patients.find(function (x) { return x.id === id; });
      if (!p) return;
      $('patientModalTitle').textContent = 'Edit follow-up';
      $('pId').value = p.id;
      $('pName').value = p.name;
      $('pPhone').value = p.phone;
      $('pDept').value = p.dept;
      $('pDate').value = p.date;
      $('pTime').value = p.time || '';
      $('pDoctor').value = p.doctor || '';
      $('pNote').value = p.note || '';
      $('pStatus').value = p.status;
    } else {
      $('patientModalTitle').textContent = 'New follow-up';
      $('pId').value = '';
      $('pDate').value = toKey(new Date(Date.now() + 86400000));
      $('pStatus').value = 'scheduled';
    }
    updateFormHints();
    openModal('patientModal');
  }

  function updateFormHints() {
    const phone = $('pPhone').value;
    const intl = toIntl(phone, settings.countryCode);
    $('phonePreview').textContent = phone.trim()
      ? 'Will message ' + (intl ? '+' + intl : phone) + (digits(phone).length <= 10 ? ' (default +' + digits(settings.countryCode) + ' applied)' : '')
      : '';

    const d = $('pDate').value;
    if (d) {
      const diff = daysFrom(d);
      const tone = urgencyOf({ date: d, time: $('pTime').value, status: 'scheduled' }).tone;
      $('dateHint').innerHTML = '<b class="t-' + tone + '" style="color:var(--accent)">' +
        (diff === 0 ? 'Due today' : diff === 1 ? 'Tomorrow' : diff < 0 ? Math.abs(diff) + ' days overdue' : 'In ' + diff + ' days') +
        '</b> · ' + fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
    } else {
      $('dateHint').textContent = '';
    }

    // live smart-triage preview
    const draft = {
      id: $('pId').value || 'draft', name: $('pName').value || 'Patient', phone: phone,
      date: d || toKey(new Date()), time: $('pTime').value, dept: $('pDept').value,
      doctor: $('pDoctor').value, note: $('pNote').value, status: $('pStatus').value, reminders: []
    };
    if (d) {
      const r = riskOf(draft, patients.concat([{ id: 'draft' }]));
      $('formAiNote').innerHTML = svg('spark') + '<div><b>Smart triage ' + r.score + '% · ' + r.band + ' risk.</b> ' +
        esc(r.reasons.slice(0, 3).join(' · ') || 'No extra risk signals.') + '</div>';
    }
  }

  function submitPatient(e) {
    e.preventDefault();
    const name = $('pName').value.trim();
    const phone = $('pPhone').value.trim();
    const date = $('pDate').value;

    let bad = false;
    function mark(inputId, errId, isBad) {
      const f = $(inputId).closest('.field');
      f.classList.toggle('invalid', isBad);
      $(errId).hidden = !isBad;
      if (isBad) bad = true;
    }
    mark('pName', 'errName', !name);
    mark('pPhone', 'errPhone', digits(phone).length < 6);
    mark('pDate', 'errDate', !parseKey(date));
    if (bad) { toast('Please complete the highlighted fields', 'err'); return; }

    const id = $('pId').value;
    const payload = {
      name: name, phone: phone, date: date, time: $('pTime').value,
      dept: $('pDept').value, doctor: $('pDoctor').value.trim(),
      note: $('pNote').value.trim(), status: $('pStatus').value
    };

    if (id) {
      const p = patients.find(function (x) { return x.id === id; });
      if (p) Object.assign(p, payload, { updatedAt: new Date().toISOString() });
      toast('Follow-up updated');
    } else {
      patients.push(normaliseRecord(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, payload)));
      toast('Saved — ' + name + ' added to the log');
    }
    savePatients();
    closeModal('patientModal');
    render();
  }

  /* ───────────────────────── remind sheet ───────────────────────── */

  function openRemind(id) {
    const p = patients.find(function (x) { return x.id === id; });
    if (!p) return;
    ui.remindId = id;
    ui.tmplId = suggestedTemplate(p);

    $('remindWho').innerHTML =
      '<span class="rw-name">' + esc(p.name) + '</span>' +
      '<span class="rw-line">' + esc(prettyPhone(p.phone, settings.countryCode)) + '</span>' +
      '<span class="rw-line">' + esc(p.dept) + '</span>' +
      '<span class="rw-line">' + esc(fmtDate(p.date) + (p.time ? ' · ' + fmtTime(p.time) : '')) + '</span>';

    const sug = suggestedTemplate(p);
    $('tmplTabs').innerHTML = settings.templates.map(function (t) {
      return '<button class="tmpl-tab' + (t.id === ui.tmplId ? ' active' : '') + '" role="tab" data-tmpl="' + esc(t.id) + '" type="button">' +
        esc(t.name) + (t.id === sug ? '<span class="badge-ai">✦ suggested</span>' : '') + '</button>';
    }).join('');

    const r = riskOf(p);
    $('remindAiNote').innerHTML = svg('spark') + '<div><b>Smart triage ' + r.score + '% · ' + r.band + ' risk.</b> ' +
      esc(r.reasons.slice(0, 3).join(' · ') || '') + ' — “' +
      esc((settings.templates.find(function (t) { return t.id === sug; }) || {}).name || 'Gentle reminder') + '” fits best.</div>';

    applyTemplate();
    renderRemindHistory(p);
    openModal('remindModal');
  }

  function currentTemplate() {
    return settings.templates.find(function (t) { return t.id === ui.tmplId; }) || settings.templates[0];
  }
  function applyTemplate() {
    const p = patients.find(function (x) { return x.id === ui.remindId; });
    if (!p) return;
    const t = currentTemplate();
    $('remindText').value = renderTemplate(t.body, p);
    updateMsgMeta();
    wireSendButtons(); // hrefs must be live the moment the sheet opens
  }
  function updateMsgMeta() {
    const v = $('remindText').value;
    $('msgCount').textContent = v.length;
    $('msgParts').textContent = v.length <= 160 ? 1 : Math.ceil(v.length / 153);
  }
  function renderRemindHistory(p) {
    const h = p.reminders || [];
    $('remindHistory').innerHTML = h.length
      ? '<b>Reminder log</b><ul>' + h.slice(-5).reverse().map(function (r) {
          return '<li>' + esc(new Date(r.at).toLocaleString()) + ' · ' + esc(r.channel) +
            (r.template ? ' · ' + esc(r.template) : '') + '</li>';
        }).join('') + '</ul>'
      : '';
  }

  function logReminder(channel) {
    const p = patients.find(function (x) { return x.id === ui.remindId; });
    if (!p) return;
    p.reminders = p.reminders || [];
    p.reminders.push({
      at: new Date().toISOString(), channel: channel,
      template: (currentTemplate() || {}).name || ''
    });
    if (p.status === 'scheduled') p.status = 'reminded';
    p.updatedAt = new Date().toISOString();
    savePatients();
    renderRemindHistory(p);
    render();
  }

  function wireSendButtons() {
    const p = patients.find(function (x) { return x.id === ui.remindId; });
    if (!p) return;
    const intl = toIntl(p.phone, settings.countryCode);
    const text = $('remindText').value;

    const wa = $('sendWa');
    wa.href = intl ? 'https://wa.me/' + intl + '?text=' + encodeURIComponent(text) : '#';
    wa.setAttribute('aria-disabled', intl ? 'false' : 'true');
    wa.title = intl ? '' : 'No valid phone number';

    $('sendSms').href = intl ? 'sms:+' + intl + '?&body=' + encodeURIComponent(text) : '#';
    $('sendCall').href = intl ? 'tel:+' + intl : '#';
    $('copyNumLabel').textContent = prettyPhone(p.phone, settings.countryCode) || 'Copy number';
  }

  /* ───────────────────────── settings ───────────────────────── */

  function openSettings() {
    $('sClinic').value = settings.clinic || '';
    $('sClinicPhone').value = settings.clinicPhone || '';
    $('sCountry').value = settings.countryCode || '';
    renderTmplEditor();
    updateStorageInfo();
    openModal('settingsModal');
  }
  function renderTmplEditor() {
    $('tmplEditor').innerHTML = settings.templates.map(function (t, i) {
      return '<div class="tmpl-card" data-tmpl-index="' + i + '">' +
        '<div class="tmpl-card-head">' +
          '<input class="input" data-tmpl-name="' + i + '" value="' + esc(t.name) + '" maxlength="40" aria-label="Template name" />' +
          '<span class="ai-pill sm">' + (i + 1) + '</span>' +
        '</div>' +
        '<textarea class="input msg" rows="5" data-tmpl-body="' + i + '" aria-label="Template message">' + esc(t.body) + '</textarea>' +
      '</div>';
    }).join('');
  }
  function readSettingsForm() {
    settings.clinic = $('sClinic').value.trim();
    settings.clinicPhone = $('sClinicPhone').value.trim();
    settings.countryCode = digits($('sCountry').value) || '91';
    $$('[data-tmpl-name]').forEach(function (el) {
      const i = Number(el.getAttribute('data-tmpl-name'));
      if (settings.templates[i]) settings.templates[i].name = el.value.trim() || settings.templates[i].name;
    });
    $$('[data-tmpl-body]').forEach(function (el) {
      const i = Number(el.getAttribute('data-tmpl-body'));
      if (settings.templates[i]) settings.templates[i].body = el.value;
    });
    saveSettings();
  }
  function updateStorageInfo() {
    let bytes = 0;
    try {
      bytes = (localStorage.getItem(K_PATIENTS) || '').length + (localStorage.getItem(K_SETTINGS) || '').length;
    } catch (e) {}
    $('storageInfo').innerHTML = '<span class="storage-line">' + patients.length + ' records · ' +
      (bytes / 1024).toFixed(1) + ' KB in localStorage (' + K_PATIENTS + ', ' + K_SETTINGS + ')</span>';
  }

  function exportBackup() {
    readSettingsForm();
    const blob = new Blob([JSON.stringify({
      app: 'ReturnPulse', version: 1, exportedAt: new Date().toISOString(),
      settings: settings, patients: patients
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'returnpulse-backup-' + toKey(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('Backup downloaded');
  }

  function importBackup(file) {
    const fr = new FileReader();
    fr.onload = function () {
      try {
        const data = JSON.parse(String(fr.result));
        const incoming = Array.isArray(data) ? data : data.patients;
        if (!Array.isArray(incoming)) throw new Error('bad shape');
        const clean = incoming.filter(function (x) { return x && x.name && x.date; }).map(normaliseRecord);
        if (data.settings && data.settings.clinic) {
          settings.clinic = data.settings.clinic;
          if (data.settings.clinicPhone) settings.clinicPhone = data.settings.clinicPhone;
          if (Array.isArray(data.settings.templates) && data.settings.templates.length) settings.templates = data.settings.templates;
          saveSettings();
        }
        patients = clean;
        savePatients();
        render();
        toast('Restored ' + clean.length + ' records');
      } catch (e) {
        toast('That file is not a ReturnPulse backup', 'err');
      }
    };
    fr.readAsText(file);
  }

  /* ───────────────────────── ⋯ menu ───────────────────────── */

  let menuEl = null;
  function closeMenu() {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
  }
  function openMenu(id, anchor) {
    closeMenu();
    const p = patients.find(function (x) { return x.id === id; });
    if (!p) return;
    ui.menuFor = id;
    menuEl = document.createElement('div');
    menuEl.className = 'modal-root';
    menuEl.style.alignItems = 'flex-start';
    menuEl.innerHTML =
      '<div class="modal-backdrop" data-close-menu="1"></div>' +
      '<div class="modal" style="max-width:230px;border-radius:14px;animation:none;box-shadow:var(--shadow-2)">' +
        '<div class="modal-body" style="padding:6px">' +
          '<button class="link-btn" data-act="edit">' + svg('edit', 'ico-sm') + ' Edit details</button>' +
          '<button class="link-btn" data-act="copy">' + svg('copy', 'ico-sm') + ' Copy phone number</button>' +
          '<button class="link-btn" data-act="remind">' + svg('bell', 'ico-sm') + ' Send reminder</button>' +
          '<button class="link-btn" data-act="reset">' + svg('clock', 'ico-sm') + ' Reset to scheduled</button>' +
          '<button class="link-btn" data-act="del" style="color:#e01b2c">' + svg('trash', 'ico-sm') + ' Delete record</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(menuEl);
    const panel = menuEl.querySelector('.modal');
    const r = anchor.getBoundingClientRect();
    panel.style.position = 'fixed';
    const ph = 232;
    panel.style.top = Math.min(Math.max(8, r.bottom + 6), window.innerHeight - ph - 8) + 'px';
    panel.style.left = Math.max(8, Math.min(r.right - 230, window.innerWidth - 238)) + 'px';
    panel.style.width = '230px';
    panel.style.maxHeight = 'none';
  }

  function menuAction(act) {
    const id = ui.menuFor;
    const p = patients.find(function (x) { return x.id === id; });
    closeMenu();
    if (!p) return;
    if (act === 'edit') return openPatientForm(id);
    if (act === 'copy') return copyText(p.phone || toIntl(p.phone, settings.countryCode), 'Number');
    if (act === 'remind') return openRemind(id);
    if (act === 'reset') {
      p.status = 'scheduled'; p.updatedAt = new Date().toISOString();
      savePatients(); render(); return toast('Reset to scheduled');
    }
    if (act === 'del') {
      if (!window.confirm('Delete ' + p.name + ' from the log? This cannot be undone.')) return;
      patients = patients.filter(function (x) { return x.id !== id; });
      savePatients(); render();
      return toast(p.name + ' deleted');
    }
  }

  /* ───────────────────────── onboarding ───────────────────────── */

  function showOnboarding() {
    $('onboarding').hidden = false;
    $('app').hidden = true;
    setTimeout(function () { $('obClinic').focus(); }, 80);
  }
  function showApp() {
    $('onboarding').hidden = true;
    $('app').hidden = false;
    render();
  }
  function finishOnboarding(withDemo) {
    const name = $('obClinic').value.trim();
    if (!name) {
      $('obClinic').focus();
      toast('Please enter your clinic name to start', 'err');
      return;
    }
    settings.clinic = name;
    settings.clinicPhone = $('obClinicPhone').value.trim();
    saveSettings();
    if (withDemo) seedDemo();
    showApp();
  }

  function seedDemo() {
    const today = new Date();
    const k = function (offset, h, m) {
      const d = new Date(today.getTime() + offset * 86400000);
      return { date: toKey(d), time: pad(h) + ':' + pad(m) };
    };
    const demo = [
      { name: 'Ramesh Kulkarni', phone: '9876543210', dept: 'Cardiology', off: -3, h: 11, m: 30, doctor: 'Dr. Mehta', note: 'BP review — bring 2 weeks of readings' },
      { name: 'Nafisa Khan', phone: '9833445566', dept: 'Physiotherapy', off: -8, h: 16, m: 0, doctor: 'Dr. Rao', note: 'Did not turn up for session 3', status: 'noshow' },
      { name: 'Fatima Sheikh', phone: '9822011223', dept: 'Physiotherapy', off: 0, h: 9, m: 0, doctor: 'Dr. Rao', note: 'Knee rehab session 4 of 8' },
      { name: 'Arun Prasad', phone: '9765409876', dept: 'Endocrinology / Diabetology', off: 0, h: 17, m: 30, doctor: 'Dr. Iyer', note: 'Fasting sugar + HbA1c report' },
      { name: 'Sunita Devi', phone: '9911223344', dept: 'Orthopaedics', off: 1, h: 10, m: 15, doctor: 'Dr. Nair', note: 'Post-op shoulder review' },
      { name: 'Joseph Mathew', phone: '9845612378', dept: 'Ophthalmology', off: 2, h: 12, m: 0, doctor: 'Dr. Bose', note: 'Dilation check — do not drive' },
      { name: 'Lakshmi Narayan', phone: '9008877665', dept: 'Dermatology', off: 4, h: 16, m: 45, doctor: 'Dr. Shah' },
      { name: 'Imran Qureshi', phone: '9345678901', dept: 'Physiotherapy', off: 6, h: 8, m: 30, doctor: 'Dr. Rao', note: 'Lumbar traction — session 2' },
      { name: 'Meera Balan', phone: '9812345670', dept: 'Obstetrics & Gynaecology', off: 12, h: 11, m: 0, doctor: 'Dr. Fernandes' },
      { name: 'Vikram Sethi', phone: '9700112233', dept: 'Dentistry / Dental Surgery', off: 21, h: 15, m: 0, doctor: 'Dr. Kapoor', note: 'Crown fitting' }
    ];
    demo.forEach(function (d) {
      const s = k(d.off, d.h, d.m);
      patients.push(normaliseRecord({
        id: uid(), name: d.name, phone: d.phone, dept: d.dept, date: s.date, time: s.time,
        doctor: d.doctor || '', note: d.note || '', status: d.status || 'scheduled',
        createdAt: new Date().toISOString()
      }));
    });
    savePatients();
  }

  /* ───────────────────────── theme ───────────────────────── */

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', settings.theme === 'dark' ? 'dark' : 'light');
    const dark = settings.theme === 'dark';
    $('themeBtnLabel').textContent = dark ? 'Light mode' : 'Dark mode';
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', dark ? '#080e19' : '#0f766e');
  }

  /* ───────────────────────── events ───────────────────────── */

  function wire() {
    // onboarding
    $('obForm').addEventListener('submit', function (e) { e.preventDefault(); finishOnboarding(false); });
    $('obDemo').addEventListener('click', function () {
      if (!$('obClinic').value.trim()) { $('obClinic').value = 'Sunrise Multi-Speciality Clinic'; }
      finishOnboarding(true);
    });

    // rails / filters
    $('addBtnRail').addEventListener('click', function () { openPatientForm(null); });
    $('fab').addEventListener('click', function () { openPatientForm(null); });
    $('clinicChip').addEventListener('click', openSettings);
    $('openSettings').addEventListener('click', openSettings);
    $('exportBtn').addEventListener('click', openSettings);

    $('stats').addEventListener('click', function (e) {
      const b = e.target.closest('[data-stat]');
      if (!b) return;
      const id = b.getAttribute('data-stat');
      ui.filter = ui.filter === id ? 'all' : id;
      render();
    });
    $('filterChips').addEventListener('click', function (e) {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      ui.filter = b.getAttribute('data-filter');
      render();
    });
    $('deptFilter').addEventListener('change', function (e) { ui.dept = e.target.value; render(); });
    $('clearFilters').addEventListener('click', function () {
      ui.filter = 'all'; ui.dept = ''; ui.q = '';
      $('search').value = ''; $('deptFilter').value = ''; $('searchClear').hidden = true;
      render();
    });
    $('sortBy').addEventListener('change', function (e) { ui.sort = e.target.value; renderList(); });

    // search
    let sT = null;
    $('search').addEventListener('input', function (e) {
      $('searchClear').hidden = !e.target.value;
      clearTimeout(sT);
      sT = setTimeout(function () { ui.q = e.target.value.trim(); render(); }, 130);
    });
    $('searchClear').addEventListener('click', function () {
      $('search').value = ''; $('searchClear').hidden = true; ui.q = ''; render(); $('search').focus();
    });

    // list actions (delegated)
    $('list').addEventListener('click', function (e) {
      const remind = e.target.closest('[data-remind]');
      if (remind) return openRemind(remind.getAttribute('data-remind'));

      const cp = e.target.closest('[data-copy-phone]');
      if (cp) {
        const p = patients.find(function (x) { return x.id === cp.getAttribute('data-copy-phone'); });
        if (p) copyText(p.phone, 'Number');
        return;
      }
      const menu = e.target.closest('[data-menu]');
      if (menu) return openMenu(menu.getAttribute('data-menu'), menu);

      const set = e.target.closest('[data-set]');
      if (set) {
        const id = set.getAttribute('data-id');
        const val = set.getAttribute('data-set');
        const p = patients.find(function (x) { return x.id === id; });
        if (!p) return;
        p.status = p.status === val ? 'scheduled' : val;
        p.updatedAt = new Date().toISOString();
        savePatients(); render();
        toast(p.name + ' marked ' + (p.status === 'arrived' ? 'attended' : p.status === 'noshow' ? 'no-show' : 'scheduled'));
      }
    });

    $('empty').addEventListener('click', function (e) {
      if (e.target.closest('#emptyAdd')) openPatientForm(null);
      if (e.target.closest('#emptyReset')) $('clearFilters').click();
    });

    // patient form
    $('patientForm').addEventListener('submit', submitPatient);
    ['pName', 'pPhone', 'pDate', 'pTime', 'pDept', 'pDoctor', 'pStatus', 'pNote'].forEach(function (id) {
      $(id).addEventListener('input', updateFormHints);
      $(id).addEventListener('change', updateFormHints);
    });

    // remind sheet
    $('tmplTabs').addEventListener('click', function (e) {
      const b = e.target.closest('[data-tmpl]');
      if (!b) return;
      ui.tmplId = b.getAttribute('data-tmpl');
      $$('.tmpl-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      applyTemplate();
    });
    $('remindText').addEventListener('input', function () { updateMsgMeta(); wireSendButtons(); });

    ['sendWa', 'sendSms', 'sendCall'].forEach(function (id) {
      $(id).addEventListener('click', function (e) {
        const href = $(id).getAttribute('href');
        if (!href || href === '#') { e.preventDefault(); toast('Add a valid phone number first', 'err'); return; }
        const label = id === 'sendWa' ? 'WhatsApp' : id === 'sendSms' ? 'SMS' : 'Call';
        setTimeout(function () { logReminder(label); }, 250);
        toast(label === 'Call' ? 'Opening dialler' : 'Opening ' + label);
      });
    });
    $('copyMsg').addEventListener('click', function () { copyText($('remindText').value, 'Message'); logReminder('copied'); });
    $('copyNum').addEventListener('click', function () {
      const p = patients.find(function (x) { return x.id === ui.remindId; });
      if (p) copyText(p.phone || toIntl(p.phone, settings.countryCode), 'Number');
    });
    $('remindMark').addEventListener('click', function () {
      const p = patients.find(function (x) { return x.id === ui.remindId; });
      if (!p) return;
      p.status = p.status === 'reminded' ? 'scheduled' : 'reminded';
      p.updatedAt = new Date().toISOString();
      savePatients(); render();
      $('remindMark').textContent = p.status === 'reminded' ? 'Mark as not reminded' : 'Mark as reminded';
      toast('Status updated');
    });

    // settings
    ['sClinic', 'sClinicPhone', 'sCountry'].forEach(function (id) {
      $(id).addEventListener('change', function () { readSettingsForm(); render(); });
    });
    $('tmplEditor').addEventListener('input', function () { readSettingsForm(); });
    $('resetTmpl').addEventListener('click', function () {
      settings.templates = DEFAULT_TEMPLATES.map(function (t) { return Object.assign({}, t); });
      saveSettings(); renderTmplEditor(); toast('Default templates restored');
    });
    $('doExport').addEventListener('click', exportBackup);
    $('doImport').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    });
    $('doClear').addEventListener('click', function () {
      if (!window.confirm('Delete ALL ' + patients.length + ' records from this browser? Export a backup first if you need it.')) return;
      patients = [];
      savePatients(); render(); updateStorageInfo(); toast('All records deleted');
    });

    // theme
    $('themeBtn').addEventListener('click', function () {
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      saveSettings(); applyTheme();
    });

    // generic modal closing
    document.addEventListener('click', function (e) {
      const c = e.target.closest('[data-close]');
      if (c) closeModal(c.getAttribute('data-close'));
      const cm = e.target.closest('[data-close-menu]');
      if (cm) closeMenu();
      const act = e.target.closest('[data-act]');
      if (act && menuEl) menuAction(act.getAttribute('data-act'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (menuEl) return closeMenu();
        ['remindModal', 'patientModal', 'settingsModal'].forEach(function (id) {
          if (!$(id).hidden) closeModal(id);
        });
      }
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault(); $('search').focus();
      }
      if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey &&
          ['INPUT', 'TEXTAREA', 'SELECT'].indexOf(document.activeElement.tagName) < 0 &&
          $('patientModal').hidden && $('remindModal').hidden && $('settingsModal').hidden) {
        e.preventDefault(); openPatientForm(null);
      }
    });

    // cross-tab sync + live recolour as the clock moves
    window.addEventListener('storage', function (e) {
      if (e.key === K_PATIENTS || e.key === K_SETTINGS) { loadAll(); applyTheme(); render(); }
    });
    setInterval(function () {
      if ($('app').hidden) return;
      renderStats(); renderChips(); renderAiBar(); renderList();
    }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !$('app').hidden) render();
    });
  }

  /* ───────────────────────── boot ───────────────────────── */

  let booted = false;
  function init() {
    if (booted) return;
    booted = true;
    if (!storageAvailable()) flagStorageBlocked();
    loadAll();
    fillSelects();
    applyTheme();
    wire();
    if (!settings.clinic) showOnboarding();
    else showApp();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // exposed for automated checks
  window.RP = {
    urgencyOf: urgencyOf, riskOf: riskOf, renderTemplate: renderTemplate, toIntl: toIntl,
    daysFrom: daysFrom, toKey: toKey, suggestedTemplate: suggestedTemplate,
    storageAvailable: storageAvailable,
    DEPARTMENTS: DEPARTMENTS, DEFAULT_TEMPLATES: DEFAULT_TEMPLATES,
    state: function () { return { settings: settings, patients: patients }; },
    seedDemo: seedDemo
  };
})();
