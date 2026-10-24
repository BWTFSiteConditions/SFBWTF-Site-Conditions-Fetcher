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

function srcLine(src) {
  if (!src) return '';
  const kind = src.measured ? 'measured' : src.predicted ? 'predicted' : 'model';
  const at = src.at ? ` · ${fmtLaTime(src.at)}` : '';
  return `<span class="tag">${kind}</span><a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a> · ${src.distMi.toFixed(1)} mi away${at}`;
}

function renderSite(site, c, t) {
  const rows = FIELDS.map(([k, label]) => {
    const f = c[k];
    if (f.value == null) {
      return `<div class="row"><div class="label">${label}</div><div class="value missing">—</div><div class="meta">${esc(f.error || 'Unavailable')}</div></div>`;
    }
    const numeric = typeof f.value === 'number';
    const val = numeric ? `${f.value}${f.unit ? `<span class="unit">${esc(f.unit)}</span>` : ''}` : esc(f.value);
    const detail = f.detail ? `<span class="detail">${esc(f.detail)}</span> · ` : '';
    const alt = f.alt ? `<span class="alt">Cross-check: ${esc(f.alt.text)} from <a href="${esc(f.alt.src.url)}" target="_blank" rel="noopener">${esc(f.alt.src.name)}</a> (${f.alt.src.distMi.toFixed(1)} mi)</span>` : '';
    return `<div class="row">
      <div class="label">${label}</div>
      <div class="value${numeric ? '' : ' word'}">${val}</div>
      <div class="meta">${detail}${srcLine(f.src)}${alt}</div>
      ${f.note ? `<div class="note">${esc(f.note)}</div>` : ''}
    </div>`;
  }).join('');
  const when = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
  return `<section class="site-card"><h2>${esc(site.name)}<small>Group ${site.group} · ${when}</small></h2>${rows}</section>`;
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
  if (t - Date.now() > 15 * 60e3) {
    status.textContent = 'That time is in the future. Values would be forecasts.';
  } else status.textContent = 'Fetching…';
  const btn = document.querySelector('.go');
  btn.disabled = true;
  const get = createFetcher();
  const sites = SITES.filter((s) => ids.includes(s.id));
  try {
    const all = await Promise.all(sites.map((s) => getConditions(s, t, { get })));
    $('results').innerHTML = sites.map((s, i) => renderSite(s, all[i], t)).join('');
    if (status.textContent === 'Fetching…') status.textContent = `Fetched ${fmtLaTime(new Date())}.`;
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
