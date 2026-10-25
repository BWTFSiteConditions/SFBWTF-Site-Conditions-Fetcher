// Fetches and snaps conditions for the BWTF "Water Sampling Data Sheet".
// Pure browser/Node module: every value is fetched live from public APIs
// that allow cross-origin requests. Nothing is stored or hosted here.

export const TZ = 'America/Los_Angeles';

// Coordinates are the ones registered for each site in Surfrider's BWTF
// database (site ids in brackets), taken from the chapter's data export.
export const SITES = [
  { id: 'aquatic-park', name: 'Aquatic Park', group: 'A', bwtfId: 9006, lat: 37.807194, lon: -122.422861, bay: true, tide: '9414305' },
  { id: 'crissy-east', name: 'Crissy Field Beach East', group: 'A', bwtfId: 9178, lat: 37.806861, lon: -122.453028, bay: true, tide: '9414290' },
  { id: 'china-beach', name: 'China Beach', group: 'B', bwtfId: 9173, lat: 37.788167, lon: -122.49175, tide: '9414290' },
  { id: 'baker-lobos', name: 'Baker Beach at Lobos Creek', group: 'B', bwtfId: 9177, lat: 37.790889, lon: -122.486139, tide: '9414290' },
  { id: 'ob-lincoln', name: 'Ocean Beach at Lincoln Way', group: 'C', bwtfId: 9172, lat: 37.763917, lon: -122.511667, tide: '9414275' },
  { id: 'ob-vicente', name: 'Ocean Beach at Vicente St', group: 'C', bwtfId: 9005, lat: 37.737917, lon: -122.508222, tide: '9414275' },
];

// Sheet wording.
export const WEATHER = ['sunny', 'partly cloudy', 'overcast', 'fog', 'light rain', 'heavy rain', 'snow'];
export const WAVE_BANDS = [
  [1, '<1 ft'], [2, '1–2 ft'], [4, '2–4 ft'], [6, '4–6 ft'], [9, '6–9 ft'], [12, '9–12 ft'], [Infinity, '12+ ft'],
];

export const RAIN_WINDOW_H = 72;      // SFPUC: avoid water contact 72 h after rain
export const RAIN_THRESHOLD_IN = 0.1; // agreed rule: ≥0.1 in total in that window
export const FORT_POINT_MAX_MI = 2.5; // use the measured Fort Point station for air/wind when this close

const FORT_POINT = { id: '9414290', name: 'NOAA Fort Point 9414290', lat: 37.806306, lon: -122.465889 };
const TIDE_STATIONS = [
  { id: '9414290', name: 'NOAA Fort Point (Golden Gate) 9414290', lat: 37.806306, lon: -122.465889 },
  { id: '9414305', name: 'NOAA North Point, Pier 41 9414305', lat: 37.81, lon: -122.413 },
  { id: '9414275', name: 'NOAA Ocean Beach 9414275', lat: 37.775, lon: -122.513 },
];
const BUOY = { name: 'SF Bar buoy 46237 (CDIP 142)', lat: 37.7879, lon: -122.6319, url: 'https://www.ndbc.noaa.gov/station_page.php?station=46237' };
const COOPS = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const CDIP_RT = 'https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/realtime/142p1_rt.nc.ascii';
const ERDDAP = 'https://erddap.sensors.ioos.us/erddap/tabledap/edu_ucsd_cdip_142.csv';

const H = 3600e3;
const KT_TO_MPH = 1.150779;
const M_TO_FT = 3.28084;

// ---------- pure helpers ----------

export function distanceMi(aLat, aLon, bLat, bLon) {
  const r = (x) => (x * Math.PI) / 180;
  const dLat = r(bLat - aLat), dLon = r(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

export const cToF = (c) => (c * 9) / 5 + 32;

export function compass8(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export function waveBand(ft) {
  return WAVE_BANDS.find(([max]) => ft < max)[1];
}

// WMO weather code (Open-Meteo) -> sheet choice.
export function weatherFromCode(code) {
  if (code <= 1) return 'sunny';
  if (code === 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 80].includes(code)) return 'light rain';
  if ([63, 65, 66, 67, 81, 82, 95, 96, 99].includes(code)) return 'heavy rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return null;
}

// Tide at time t from the predicted highs and lows around it: low or high (whichever half of the
// swing t is in), rising or falling, and the height by NOAA's cosine interpolation between the two
// turns (subordinate stations publish only highs and lows, not 6-minute heights).
export function tideState(t, extremes) {
  // extremes: [{at: Date, type: 'H'|'L', ft}] sorted by time
  let prev = null, next = null;
  for (const e of extremes) {
    if (e.at <= t) prev = e;
    else { next = e; break; }
  }
  if (!prev || !next) return null;
  const frac = (t - prev.at) / (next.at - prev.at);
  const ft = (prev.ft + next.ft) / 2 + ((prev.ft - next.ft) / 2) * Math.cos(Math.PI * frac);
  const turn = frac < 0.5 ? prev : next;
  return { value: turn.type === 'H' ? 'high' : 'low', rising: next.type === 'H', ft, prev, next };
}

// Minutes Los Angeles is ahead of UTC at instant d (negative).
function laOffsetMin(d) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(d / 60e3) * 60e3) / 60e3;
}

// "2026-02-16", "16:30" in San Francisco local time -> Date
export function laToDate(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall + 8 * H;
  for (let i = 0; i < 2; i++) t = wall - laOffsetMin(new Date(t)) * 60e3;
  return new Date(t);
}

export function fmtLaTime(d) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
}
export function fmtLaDate(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); // yyyy-mm-dd
}

const utcDate = (d) => d.toISOString().slice(0, 10);
const coopsTime = (d) => d.toISOString().slice(0, 16).replace(/-/g, '').replace('T', ' ');
const parseCoops = (s) => new Date(s.replace(' ', 'T') + ':00Z');

function nearest(rows, t, maxMin) {
  let best = null;
  for (const r of rows) if (!best || Math.abs(r.at - t) < Math.abs(best.at - t)) best = r;
  return best && Math.abs(best.at - t) <= maxMin * 60e3 ? best : null;
}

// ---------- fetching (shared per run so several sites reuse one request) ----------

export function createFetcher(fetchImpl = globalThis.fetch) {
  const cache = new Map();
  return (url, kind = 'json') => {
    const key = kind + ' ' + url;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 20000);
        try {
          const res = await fetchImpl(url, { signal: ctl.signal });
          const body = kind === 'json' ? await res.json() : await res.text();
          if (!res.ok && kind !== 'json') throw new Error(`HTTP ${res.status}`);
          return body;
        } finally { clearTimeout(timer); }
      })());
    }
    return cache.get(key);
  };
}

function openMeteoUrl(site, t, now) {
  // The forecast API keeps ~3 months of past hours; older dates use the historical-forecast archive.
  const recent = now - t < 85 * 24 * H;
  const base = recent ? 'https://api.open-meteo.com/v1/forecast' : 'https://historical-forecast-api.open-meteo.com/v1/forecast';
  const q = new URLSearchParams({
    latitude: site.lat, longitude: site.lon, cell_selection: 'nearest',
    hourly: 'temperature_2m,weather_code,precipitation,wind_speed_10m,wind_direction_10m',
    start_date: utcDate(new Date(t - (RAIN_WINDOW_H + 2) * H)), end_date: utcDate(new Date(+t + 2 * H)),
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch',
    timezone: 'GMT', timeformat: 'unixtime',
  });
  return `${base}?${q}`;
}

function marineUrl(site, t) {
  const q = new URLSearchParams({
    latitude: site.lat, longitude: site.lon, hourly: 'wave_height,sea_surface_temperature',
    start_date: utcDate(new Date(t - 2 * H)), end_date: utcDate(new Date(+t + 2 * H)),
    temperature_unit: 'fahrenheit', length_unit: 'imperial', timezone: 'GMT', timeformat: 'unixtime',
  });
  return `https://marine-api.open-meteo.com/v1/marine?${q}`;
}

function hourlyRows(json, keys) {
  return json.hourly.time.map((s, i) => {
    const row = { at: new Date(s * 1000) };
    for (const k of keys) row[k] = json.hourly[k][i];
    return row;
  });
}

async function openMeteo(get, site, t, now) {
  const url = openMeteoUrl(site, t, now);
  const json = await get(url);
  if (json.error) throw new Error(json.reason);
  const rows = hourlyRows(json, ['temperature_2m', 'weather_code', 'precipitation', 'wind_speed_10m', 'wind_direction_10m']);
  const at = nearest(rows.filter((r) => r.temperature_2m != null), t, 45);
  // Each hourly precipitation value is the total for the hour ending at its timestamp.
  const window = rows.filter((r) => r.at > t - RAIN_WINDOW_H * H && r.at - H < t && r.precipitation != null);
  const rain = window.reduce((s, r) => s + r.precipitation, 0);
  return {
    url, at,
    rain, rainHours: window.length,
    src: { name: 'Open-Meteo model', url, distMi: distanceMi(site.lat, site.lon, json.latitude, json.longitude) },
  };
}

async function fortPoint(get, t) {
  const q = (product) => `${COOPS}?${new URLSearchParams({
    product, station: FORT_POINT.id, begin_date: coopsTime(new Date(t - H)), end_date: coopsTime(new Date(+t + H)),
    units: 'english', time_zone: 'gmt', format: 'json', application: 'bwtf_field_conditions',
  })}`;
  const [air, wind] = await Promise.all([get(q('air_temperature')), get(q('wind'))]);
  const airRow = nearest((air.data || []).filter((r) => r.v !== '').map((r) => ({ at: parseCoops(r.t), f: +r.v })), t, 30);
  const windRow = nearest((wind.data || []).filter((r) => r.s !== '').map((r) => ({ at: parseCoops(r.t), kt: +r.s, deg: +r.d })), t, 30);
  return { airRow, windRow, apiAir: q('air_temperature'), apiWind: q('wind') };
}

async function tides(get, site, t) {
  // Each site names its station: the nearest one on the same side of the Golden Gate.
  const s0 = TIDE_STATIONS.find((s) => s.id === site.tide);
  const st = { ...s0, distMi: distanceMi(site.lat, site.lon, s0.lat, s0.lon) };
  const url = `${COOPS}?${new URLSearchParams({
    product: 'predictions', station: st.id, begin_date: coopsTime(new Date(t - 24 * H)).slice(0, 8),
    end_date: coopsTime(new Date(+t + 24 * H)).slice(0, 8), datum: 'MLLW', interval: 'hilo', units: 'english',
    time_zone: 'gmt', format: 'json', application: 'bwtf_field_conditions',
  })}`;
  const json = await get(url);
  if (!json.predictions) throw new Error(json.error?.message || 'no tide predictions');
  const ex = json.predictions.map((p) => ({ at: parseCoops(p.t), type: p.type, ft: +p.v }));
  return { st, ...tideState(t, ex) };
}

function parseDap(text) {
  const out = {};
  for (const m of text.matchAll(/^(\w+)\[\d+\]\n([^\n]*)/gm)) out[m[1]] = m[2].split(',').map((x) => +x.trim());
  return out;
}

// SF Bar buoy: CDIP's realtime file (last ~3 weeks, updated every 30 min) or the IOOS ERDDAP archive.
async function buoy(get, t, now) {
  let src = null, water = null, wave = null;
  const tryCdip = async () => {
    const vars = ['waveTime', 'waveHs', 'waveFlagPrimary', 'sstTime', 'sstSeaSurfaceTemperature', 'sstFlagPrimary'].join(',');
    const d = parseDap(await get(`${CDIP_RT}?${vars}`, 'text'));
    const waves = d.waveTime.map((s, i) => ({ at: new Date(s * 1000), m: d.waveHs[i], ok: d.waveFlagPrimary[i] === 1 })).filter((r) => r.ok);
    const ssts = d.sstTime.map((s, i) => ({ at: new Date(s * 1000), c: d.sstSeaSurfaceTemperature[i], ok: d.sstFlagPrimary[i] === 1 })).filter((r) => r.ok);
    return { wave: nearest(waves, t, 60), water: nearest(ssts, t, 60), via: 'CDIP realtime' };
  };
  const tryErddap = async () => {
    const q = `time,sea_water_temperature,sea_water_temperature_qc_agg,sea_surface_wave_significant_height,sea_surface_wave_significant_height_qc_agg`
      + `&time>=${new Date(t - H).toISOString()}&time<=${new Date(+t + H).toISOString()}`;
    const text = await get(`${ERDDAP}?${q.replace(/>/g, '%3E').replace(/</g, '%3C')}`, 'text');
    const rows = text.trim().split('\n').slice(2).map((l) => l.split(','));
    const good = (f) => f === '1' || f === '2' || f === 'NaN';
    const waters = rows.filter((r) => r[1] !== 'NaN' && good(r[2])).map((r) => ({ at: new Date(r[0]), c: +r[1] }));
    const waves = rows.filter((r) => r[3] !== 'NaN' && good(r[4])).map((r) => ({ at: new Date(r[0]), m: +r[3] }));
    return { wave: nearest(waves, t, 60), water: nearest(waters, t, 60), via: 'IOOS ERDDAP' };
  };
  const order = now - t < 18 * 24 * H ? [tryCdip, tryErddap] : [tryErddap, tryCdip];
  for (const f of order) {
    try {
      const r = await f();
      if (!water && r.water) { water = r.water; src = src || r.via; }
      if (!wave && r.wave) { wave = r.wave; src = src || r.via; }
      if (water && wave) break;
    } catch { /* try the next source */ }
  }
  return { water, wave, via: src };
}

async function marine(get, site, t) {
  const url = marineUrl(site, t);
  const json = await get(url);
  if (json.error) throw new Error(json.reason);
  const at = nearest(hourlyRows(json, ['wave_height', 'sea_surface_temperature']), t, 45);
  return { at, src: { name: 'Open-Meteo Marine model', url, distMi: distanceMi(site.lat, site.lon, json.latitude, json.longitude) } };
}

const settle = (p) => p.then((v) => ({ v }), (e) => ({ e }));

// Returns one entry per data sheet field: { value, unit?, src:{name,url,distMi,at}, note?, alt?, error? }
export async function getConditions(site, t, { get = createFetcher(), now = new Date() } = {}) {
  const [om, fp, td, by, mr] = await Promise.all([
    settle(openMeteo(get, site, t, now)), settle(fortPoint(get, t)), settle(tides(get, site, t)),
    settle(buoy(get, t, now)), settle(marine(get, site, t)),
  ]);
  // Each value links to a page people can read for this site and date, not the raw API response.
  const day = fmtLaDate(t), ymd = day.replace(/-/g, '');
  const fpDist = distanceMi(site.lat, site.lon, FORT_POINT.lat, FORT_POINT.lon);
  const fpPage = `https://tidesandcurrents.noaa.gov/met.html?bdate=${ymd}&edate=${ymd}&units=standard&timezone=LST/LDT&id=${FORT_POINT.id}`;
  const fpSrc = (at, api) => ({ name: FORT_POINT.name, url: fpPage, api, distMi: fpDist, at, measured: true });
  const omPage = (path, hourly, daysBefore = 0) => `https://open-meteo.com/en/docs${path}?${new URLSearchParams({
    latitude: site.lat, longitude: site.lon, hourly,
    start_date: fmtLaDate(new Date(t - daysBefore * 24 * H)), end_date: day,
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: TZ,
  })}`;
  const omPath = now - t < 85 * 24 * H ? '' : '/historical-forecast-api';
  const omSrc = (hourly, daysBefore) => om.v && { ...om.v.src, api: om.v.src.url, url: omPage(omPath, hourly, daysBefore), at: om.v.at?.at };
  const buoySrc = (at) => ({ name: BUOY.name, url: BUOY.url, distMi: distanceMi(site.lat, site.lon, BUOY.lat, BUOY.lon), at, measured: true, via: by.v?.via });
  const mrSrc = (hourly) => mr.v && { ...mr.v.src, api: mr.v.src.url, url: omPage('/marine-weather-api', hourly), at: mr.v.at?.at };
  const fail = (msg) => ({ value: null, error: msg });

  // Air temp and wind: measured Fort Point when close, else the model grid point; the other is shown as a cross-check.
  const fpAir = fp.v?.airRow && { value: Math.round(fp.v.airRow.f), unit: '°F', src: fpSrc(fp.v.airRow.at, fp.v.apiAir) };
  const omAir = om.v?.at && { value: Math.round(om.v.at.temperature_2m), unit: '°F', src: omSrc('temperature_2m') };
  const fpWind = fp.v?.windRow && { mph: fp.v.windRow.kt * KT_TO_MPH, deg: fp.v.windRow.deg, kt: fp.v.windRow.kt, src: fpSrc(fp.v.windRow.at, fp.v.apiWind) };
  const omWind = om.v?.at && { mph: om.v.at.wind_speed_10m, deg: om.v.at.wind_direction_10m, src: omSrc('wind_speed_10m,wind_direction_10m') };
  const useFp = fpDist <= FORT_POINT_MAX_MI;
  const pick = (a, b) => (useFp ? [a || b, a ? b : null] : [b || a, b ? a : null]);

  const [air, airAlt] = pick(fpAir, omAir);
  const [wind, windAlt] = pick(fpWind, omWind);

  const out = {};
  out.airTemp = air ? { ...air, alt: airAlt && { text: `${airAlt.value}°F`, src: airAlt.src } } : fail('No air temperature reading near that time.');

  const code = om.v?.at?.weather_code;
  out.weather = code != null
    ? { value: weatherFromCode(code), src: omSrc('weather_code'), detail: `WMO code ${code}`, note: 'If observed weather was different, record what you saw.' }
    : fail(om.e ? String(om.e.message || om.e) : 'No weather estimate for that time.');

  const windText = (w) => `${Math.round(w.mph)} mph ${compass8(w.deg)}`;
  out.windSpeed = wind
    ? { value: Math.round(wind.mph), unit: 'mph', src: wind.src, detail: wind.kt != null ? `${wind.kt} kt` : null, alt: windAlt && { text: windText(windAlt), src: windAlt.src } }
    : fail('No wind reading near that time.');
  out.windDir = wind
    ? { value: compass8(wind.deg), src: wind.src, detail: `from ${Math.round(wind.deg)}°`, note: wind.mph < 1 ? 'Calm: direction is not meaningful.' : null }
    : fail('No wind reading near that time.');

  out.recentRain = om.v
    ? { value: om.v.rain >= RAIN_THRESHOLD_IN ? 'Yes' : 'No', src: omSrc('precipitation', 3), detail: `${om.v.rain.toFixed(2)} in in the ${RAIN_WINDOW_H} h before`, note: `Yes = ${RAIN_THRESHOLD_IN} in or more in ${RAIN_WINDOW_H} h (SFPUC 72-hour advisory).` }
    : fail(String(om.e?.message || 'Rain history unavailable.'));

  const mrSst = mr.v?.at?.sea_surface_temperature;
  const mrWave = mr.v?.at?.wave_height;
  if (by.v?.water) {
    out.waterTemp = { value: Math.round(cToF(by.v.water.c)), unit: '°F', src: buoySrc(by.v.water.at), detail: `${by.v.water.c.toFixed(1)} °C` };
  } else if (mrSst != null) {
    out.waterTemp = { value: Math.round(mrSst), unit: '°F', src: mrSrc('sea_surface_temperature'), note: 'Buoy reading unavailable; model estimate.' };
  } else out.waterTemp = fail('No water temperature near that time.');
  if (site.bay && out.waterTemp.value != null) out.waterTemp.note = 'Measured offshore, outside the Golden Gate; the bay can differ.';

  const waveFt = by.v?.wave ? by.v.wave.m * M_TO_FT : mrWave;
  const waveSrc = by.v?.wave ? buoySrc(by.v.wave.at) : mrSrc('wave_height');
  if (waveFt == null) out.waveHeight = fail('No wave reading near that time.');
  else if (site.bay) {
    out.waveHeight = { value: 'observe on site', src: waveSrc, detail: `offshore ${waveFt.toFixed(1)} ft (${waveBand(waveFt)})`, note: 'Sheltered bay beach: offshore swell does not reach it. Judge by eye.' };
  } else {
    out.waveHeight = {
      value: waveBand(waveFt), src: waveSrc, detail: `${waveFt.toFixed(1)} ft significant height`,
      note: site.group === 'B' ? 'Offshore swell; this cove is often smaller.' : null,
    };
  }

  if (td.v?.value) {
    const ftStr = (x) => `${x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} ft`;
    const f = (e) => e && `${e.type === 'H' ? 'High' : 'Low'} ${fmtLaTime(e.at)} (${ftStr(e.ft)})`;
    out.tide = {
      value: td.v.value, rising: td.v.rising, heightFt: td.v.ft,
      sub: ftStr(td.v.ft),
      detail: `${td.v.rising ? 'Rising' : 'Falling'}. ${[f(td.v.prev), f(td.v.next)].join(' → ')}`,
      src: { name: td.v.st.name, url: `https://tidesandcurrents.noaa.gov/noaatidepredictions.html?id=${td.v.st.id}&units=standard&bdate=${ymd}&edate=${ymd}&timezone=LST/LDT&clock=12hour&datum=MLLW&interval=hilo&action=dailychart`, distMi: td.v.st.distMi, predicted: true },
      note: 'Height above mean lower low water (MLLW), estimated between the predicted low and high.',
    };
  } else out.tide = fail(String(td.e?.message || 'Tide predictions unavailable.'));

  return out;
}

export const FIELDS = [
  ['airTemp', 'Air Temperature'], ['weather', 'Weather'], ['windSpeed', 'Wind Speed'], ['windDir', 'Wind Direction'],
  ['recentRain', 'Rain in Last 72hr'], ['waterTemp', 'Water Temperature'], ['waveHeight', 'Wave Height'], ['tide', 'Tide'],
];
