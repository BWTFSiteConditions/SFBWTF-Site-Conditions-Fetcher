# BWTF Field Conditions

Basic fetcher for local site conditions used in SF BWTF Testing. The browser calls public APIs directly, and nothing is stored or hosted except the page itself. The only thing kept is the last site and time choice, in the phone's `localStorage`. It is separate from the BWTF_SF website.

## Fields and sources

| Sheet field | Value | Source |
|---|---|---|
| Air Temp | °F | Groups A and B: NOAA Fort Point 9414290 (measured, 0.7–2.3 mi). Group C: Open-Meteo model grid point. The other source is shown as a cross-check. |
| Weather | sunny / partly cloudy / overcast / fog / light rain / heavy rain / snow | Open-Meteo WMO weather code (model; flagged "trust your eyes") |
| Wind Speed | mph | Same as Air Temp. Fort Point reports knots, converted ×1.15078. |
| Wind Direction | N NE E SE S SW W NW (coming from) | Same as Air Temp |
| Recent Rain | Yes / No | Open-Meteo hourly precipitation. **Yes = 0.1 in or more in the 72 h before sampling** (SFPUC 72-hour advisory; rule agreed with the chapter). |
| Water Temp | °F | SF Bar buoy NDBC 46237 / CDIP 142 (measured). Fallback: Open-Meteo Marine SST. |
| Wave Height | <1 ft … 12+ ft bands | SF Bar buoy significant wave height. Fallback: Open-Meteo Marine. **Aquatic Park and Crissy Field show "observe on site"**, because offshore swell doesn't reach those sheltered bay beaches. The offshore reading is still shown for reference. |
| Tide | low / high, ↑ rising or ↓ falling, and height in ft (MLLW) | NOAA CO-OPS predictions: North Point Pier 41 (Aquatic Park), Fort Point/Golden Gate (Crissy, China, Baker), Ocean Beach 9414275 (Group C). Low or high = which half of the swing between the predicted turns the sample falls in. Height is NOAA's cosine interpolation between the turns (subordinate stations publish only highs and lows); within 0.1 ft of Golden Gate's 6-minute predictions over a full cycle on Feb 16, 2026. |

Buoy data: NDBC's own files don't allow cross-origin requests, so the page reads the same buoy from CDIP's THREDDS realtime file (last ~3 weeks) and the IOOS ERDDAP archive (older dates). Both allow browser requests, so no proxy is needed.

Open-Meteo is called with `timezone=GMT&timeformat=unixtime`. With `timezone=America/Los_Angeles` it applies today's UTC offset to every date, so winter hours came back an hour off.

Site coordinates are the ones registered for each site in the Surfrider BWTF database (from the chapter's data export).


| Site | Query |
|---|---|
| Aquatic Park | `?site=aquatic-park` |
| Crissy Field Beach East | `?site=crissy-east` |
| China Beach | `?site=china-beach` |
| Baker Beach at Lobos Creek | `?site=baker-lobos` |
| Ocean Beach at Lincoln Way | `?site=ob-lincoln` |
| Ocean Beach at Vicente St | `?site=ob-vicente` |
| A whole group | `?group=A` (or `B`, `C`) |

## Run locally

```bash
python3 -m http.server 8765
```

Open http://localhost:8765. To print every field for a date from the command line (Node 18+):

```bash
node test/run.mjs 2026-02-16 16:30 ob-lincoln
```


