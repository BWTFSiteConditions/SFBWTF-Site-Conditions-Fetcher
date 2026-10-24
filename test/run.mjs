// Usage: node test/run.mjs 2026-02-16 16:30 [site-id ...]
import { SITES, FIELDS, getConditions, createFetcher, laToDate, fmtLaTime } from '../conditions.js';
const [date, time, ...ids] = process.argv.slice(2);
const t = laToDate(date, time);
const get = createFetcher();
for (const s of SITES.filter((s) => !ids.length || ids.includes(s.id))) {
  const c = await getConditions(s, t, { get });
  console.log(`\n${s.name}  ${date} ${time} (${t.toISOString()})`);
  for (const [k, label] of FIELDS) {
    const f = c[k];
    const src = f.src ? `${f.src.name} ${f.src.distMi.toFixed(1)} mi${f.src.at ? ' @' + fmtLaTime(f.src.at) : ''}${f.src.via ? ' via ' + f.src.via : ''}` : '';
    console.log(`  ${label.padEnd(15)} ${String(f.value ?? 'ERR ' + f.error).padEnd(16)} ${f.unit || ''} ${f.detail || ''} | ${src}${f.alt ? ' | alt ' + f.alt.text : ''}`);
  }
}
