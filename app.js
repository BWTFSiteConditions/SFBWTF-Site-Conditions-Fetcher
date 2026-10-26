import { SITES, FIELDS, getConditions, createFetcher, laToDate, fmtLaTime, fmtLaDate } from './conditions.js';

const KEY = 'bwtf-field-conditions:v1';
const $ = (id) => document.getElementById(id);

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: just don't remember */ }
}

function setNow() {
  const d = new Date();
  $('date').value = fmtLaDate(d);
  $('time').value = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

function renderPicker(selected) {
  const box = $('sites');
  for (const g of ['A', 'B', 'C']) {
    const div = document.createElement('div');
    div.className = 'group';
    div.innerHTML = `<div class="group-head"><span class="group-name">Group ${g}</span><button type="button" class="ghost group-all" data-group="${g}">Both</button></div>`;
    for (const s of SITES.filter((s) => s.group === g)) {
      const label = document.createElement('label');
      label.className = 'site';
      label.innerHTML = `<input type="checkbox" name="site" value="${s.id}"${selected.includes(s.id) ? ' checked' : ''}> <span>${s.name}</span>`;
      div.append(label);
    }
    box.append(div);
  }
  box.addEventListener('click', (e) => {
    const g = e.target.dataset?.group;
    if (!g) return;
    const boxes = [...box.querySelectorAll('input')].filter((i) => SITES.find((s) => s.id === i.value).group === g);
    const on = !boxes.every((i) => i.checked);
    boxes.forEach((i) => { i.checked = on; });
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Short source names for the line under each value; each links to its source page.
function shortName(name) {
  if (name.startsWith('Open-Meteo Marine')) return 'Open-Meteo Marine';
  if (name.startsWith('Open-Meteo')) return 'Open-Meteo';
  if (name.startsWith('SF Bar buoy')) return 'SF Bar buoy';
  if (name.includes('Fort Point')) return 'Fort Point';
  return 'NOAA tides';
}

const link = (src) => `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(shortName(src.name))}</a>`;

// The line under a value: what it means, where it came from, how far away, and any cross-check.
function srcLine(k, f) {
  const src = f.src;
  const kind = src.measured ? 'Measured' : src.predicted ? 'Predicted' : 'Model';
  const where = `${kind}: ${link(src)}, ${src.distMi.toFixed(1)} mi${src.at ? `, ${fmtLaTime(src.at)}` : ''}.`;
  const leads = {
    windDir: () => `Coming from ${esc(f.detail.replace('from ', ''))}.`,
    recentRain: () => `${esc(f.detail)}.`,
    tide: () => `${esc(f.detail)}.`,
    waveHeight: () => (f.detail ? `${esc(f.detail.charAt(0).toUpperCase() + f.detail.slice(1))}.` : ''),
  };
  const lead = leads[k] ? leads[k]() : '';
  const alt = f.alt ? ` ${link(f.alt.src)} reads ${esc(f.alt.text)} (${f.alt.src.distMi.toFixed(1)} mi).` : '';
  return `${lead} ${where}${alt}`.trim();
}

// Up arrow = rising, down = falling.
function arrow(rising) {
  return `<svg class="arrow" viewBox="0 0 24 24" role="img" aria-label="${rising ? 'rising' : 'falling'}"><path d="${rising ? 'M12 20V5M5 11l7-7 7 7' : 'M12 4v15M5 13l7 7 7-7'}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function row(k, label, f) {
  if (f.value == null) {
    return `<div class="row"><div class="row-top"><span class="label">${label}</span><span class="value missing">—</span></div><p class="src">${esc(f.error || 'Unavailable')}</p></div>`;
  }
  const numeric = typeof f.value === 'number';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const unit = f.unit === 'mph' ? '<span class="unit">mph</span>' : esc(f.unit || '');
  const val = numeric ? `${f.value}${unit}` : esc(cap(String(f.value)));
  const word = !numeric && String(f.value).length > 8;
  return `<div class="row">
    <div class="row-top"><span class="label">${label}</span><span class="value-col"><a class="value${word ? ' word' : ''}" href="${esc(f.src.url)}" target="_blank" rel="noopener" title="Open the source of this value">${val}${k === 'tide' ? arrow(f.rising) : ''}</a>${f.sub ? `<span class="sub">${esc(f.sub)}</span>` : ''}</span></div>
    <p class="src">${srcLine(k, f)}</p>
    ${f.note ? `<p class="note">${esc(f.note)}</p>` : ''}
  </div>`;
}

// Each selected site gets its own color, cycling through the BWTF phase colors (accent, banner
// tint, banner text, underline), so several sites' results are easy to tell apart while scrolling.
const SITE_THEMES = [
  { accent: '#368add', tint: '#e6f1fb', ink: '#042c53', line: '#95cdeb' }, // blue
  { accent: '#0f6e55', tint: '#e8f5f1', ink: '#0c3a32', line: '#9acec1' }, // green
  { accent: '#8932d3', tint: '#f1e8fa', ink: '#2a0044', line: '#c680ff' }, // purple
  { accent: '#057b8d', tint: '#e3f2f4', ink: '#03363e', line: '#88c8d2' }, // teal
];

function renderSite(site, c, t, first, i = 0) {
  const th = SITE_THEMES[i % SITE_THEMES.length];
  const vars = `--site-accent:${th.accent};--site-tint:${th.tint};--site-ink:${th.ink};--site-line:${th.line}`;
  const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
  return `<section class="site-card" style="${vars}">
    <div class="accent site-accent"></div>
    <header class="card-head">
      <span class="org">Surfrider SF · Blue Water Task Force</span>
      <h2>${esc(site.name)}</h2>
      <span class="when">Group ${site.group} · ${when}</span>
    </header>
    ${first ? `<div class="change-bar"><button type="button" class="ghost back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H5M11 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>Back to site and time</button></div>` : ''}
    ${FIELDS.map(([k, label]) => row(k, label, c[k])).join('')}
  </section>`;
}

async function run(e) {
  e?.preventDefault();
  const ids = [...document.querySelectorAll('input[name=site]:checked')].map((i) => i.value);
  const date = $('date').value, time = $('time').value;
  save({ sites: ids, date, time });
  const status = $('status');
  status.className = 'status';
  if (!ids.length) { status.textContent = 'Pick at least one site.'; return; }
  if (!date || !time) { status.textContent = 'Enter the date and time you sampled.'; return; }
  const t = laToDate(date, time);
  const future = t - Date.now() > 15 * 60e3;
  status.textContent = 'Fetching…';
  const btn = document.querySelector('.go');
  btn.disabled = true;
  const get = createFetcher();
  const sites = SITES.filter((s) => ids.includes(s.id));
  try {
    const all = await Promise.all(sites.map((s) => getConditions(s, t, { get })));
    $('results').innerHTML = sites.map((s, i) => renderSite(s, all[i], t, i === 0, i)).join('');
    document.body.classList.add('has-results');
    status.textContent = future ? 'That time is in the future, so these values are forecasts.' : '';
    window.scrollTo(0, 0);
  } catch (err) {
    status.className = 'status err';
    status.textContent = `Couldn't fetch conditions: ${err.message}. Check your signal and try again.`;
  } finally {
    btn.disabled = false;
  }
}

// QR codes in the field guide link with ?site=<id>[,<id>] or ?group=A; that choice wins over the remembered one.
const params = new URLSearchParams(location.search);
const fromUrl = [
  ...(params.get('site') || '').split(',').filter((id) => SITES.some((s) => s.id === id)),
  ...SITES.filter((s) => (params.get('group') || '').toUpperCase().split(',').includes(s.group)).map((s) => s.id),
];
const state = load();
renderPicker(fromUrl.length ? fromUrl : state.sites || []);
if (state.date && state.time) { $('date').value = state.date; $('time').value = state.time; } else setNow();
$('now').addEventListener('click', setNow);
$('form').addEventListener('submit', run);
// Back returns to the picker with every choice cleared: no sites ticked, date and time empty,
// nothing remembered, and no ?site= preselect left in the address.
$('results').addEventListener('click', (e) => {
  if (!e.target.closest('.back')) return;
  document.querySelectorAll('input[name=site]').forEach((i) => { i.checked = false; });
  $('date').value = '';
  $('time').value = '';
  save({});
  if (location.search) history.replaceState(null, '', location.pathname);
  document.body.classList.remove('has-results');
  $('results').innerHTML = '';
  $('status').textContent = '';
  window.scrollTo(0, 0);
});
