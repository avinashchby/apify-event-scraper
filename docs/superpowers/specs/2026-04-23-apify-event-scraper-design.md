# Apify Event Scraper Actor — Design Spec

**Date:** 2026-04-23  
**Author:** Avinash Chaubey  
**Status:** Approved

---

## Overview

A TypeScript Apify actor that scrapes events from 6 major event listing platforms, applies rich filtering, and outputs a unified event schema. Designed for two audiences:

1. **Apify Store users** — any developer or website owner who needs programmatic access to event data
2. **Founders Times WordPress plugin** (`ft-autopublisher`) — the output schema is backward-compatible with `class-apify-fetcher.php`, requiring zero plugin changes

---

## Goals

- Scrape events from Eventbrite, Meetup, Lu.ma, Partiful, Hopin, and Humanitix
- Support 8 filter dimensions: keywords, location/radius, date range, event type, industry, format (online/in-person), price (free/paid), language
- Produce a unified normalized output schema usable by any consumer
- Be publishable to the Apify Store with a polished input form UI
- Fix two known field-name bugs in the `ft-autopublisher` theme card template

---

## Non-Goals

- No OAuth flows or per-user authentication for scraped sites
- No AI enrichment inside the actor (Gemini enrichment happens in the WordPress pipeline downstream)
- No persistent state or incremental runs in v1 (full re-scrape each run)
- No scraping of paid/private event listings

---

## Architecture

### Approach: Hybrid — API/Cheerio + Playwright only where required

| Source | Strategy | Reason |
|---|---|---|
| Eventbrite | Cheerio (SSR search results) | Stable server-rendered HTML |
| Meetup | GraphQL API (public, no auth) | Public GraphQL endpoint available |
| Lu.ma | Playwright | Pure React SPA, no SSR |
| Partiful | Playwright | Heavy JS app, no public API |
| Hopin | Cheerio | SSR pages with API fragments |
| Humanitix | Cheerio | Clean SSR HTML |

Playwright is used only for the 2 sources that require it, keeping compute costs low.

### Data Flow

```
Input params
  → [for each enabled source in parallel]
      → Scraper (raw items)
      → Normalizer (unified EventItem)
  → Filter pipeline (8 filter predicates)
  → Deduplicator (cross-source dedup by URL + title similarity)
  → Apify Dataset output
```

### Project Structure

```
apify-event-scraper/
├── src/
│   ├── main.ts                  # Entry point — reads input, orchestrates scrapers
│   ├── types.ts                 # Shared TypeScript types (InputSchema, EventItem)
│   ├── filters.ts               # All 8 filter predicates
│   ├── normalizer.ts            # Maps raw source items → EventItem
│   ├── deduplicator.ts          # Cross-source dedup logic
│   └── scrapers/
│       ├── base.ts              # Abstract BaseScraper (fetch + normalize contract)
│       ├── eventbrite.ts        # Cheerio scraper
│       ├── meetup.ts            # GraphQL API scraper
│       ├── luma.ts              # Playwright scraper
│       ├── partiful.ts          # Playwright scraper
│       ├── hopin.ts             # Cheerio scraper
│       └── humanitix.ts        # Cheerio scraper
├── .actor/
│   ├── actor.json               # Apify Store metadata
│   └── input_schema.json        # Auto-generates Store UI form
├── package.json
└── tsconfig.json
```

---

## Input Schema

```jsonc
{
  // Which sources to scrape. Default: all six.
  "sources": ["eventbrite", "meetup", "luma", "partiful", "hopin", "humanitix"],

  // Keyword search — passed to each source's native search endpoint
  "query": "AI startup",

  // Location filter — use city/country OR lat+lng+radius, not both
  "location": {
    "city": "San Francisco",
    "country": "US",
    "lat": 37.7749,
    "lng": -122.4194,
    "radiusKm": 50
  },

  // Date range (YYYY-MM-DD). Default: today → +90 days
  "dateFrom": "2026-05-01",
  "dateTo": "2026-08-31",

  // Event types (multi-select). Default: all types.
  "eventTypes": ["conference", "meetup", "workshop", "hackathon", "webinar", "summit", "other"],

  // Industry tags (free text, matched against description + tags). Default: no filter.
  "industries": ["AI & Machine Learning", "Fintech"],

  // Online/in-person/both. Default: "both"
  "format": "both",

  // Free/paid/both. Default: "both"
  "priceType": "both",

  // ISO 639-1 language code. Default: no filter (all languages)
  "language": "en",

  // Hard cap on total results across all sources. Default: 200
  "maxResults": 200,

  // Cap per source to prevent one source dominating. Default: 50
  "maxResultsPerSource": 50
}
```

The `.actor/input_schema.json` maps all fields to Apify Store UI controls: dropdowns, date pickers, checkboxes, and text inputs. No manual JSON editing needed for non-technical users.

---

## Output Schema

Every event outputs this unified shape, regardless of source:

```jsonc
{
  // Core identity
  "name": "TechCrunch Disrupt 2026",
  "url": "https://eventbrite.com/e/techcrunch-disrupt-123",

  // Dates (ISO 8601)
  "startAt": "2026-06-15T09:00:00Z",
  "endDate": "2026-06-17T18:00:00Z",

  // Description (plain text, HTML stripped)
  "description": "Join 1000+ founders and investors...",

  // Location — flat string (plugin compat) + structured breakdown
  "location": "San Francisco, US",
  "venue": {
    "name": "Moscone Center",
    "address": "747 Howard St",
    "city": "San Francisco",
    "country": "US",
    "lat": 37.7845,
    "lng": -122.4026
  },

  // Format flags
  "isOnline": false,
  "format": "conference",

  // Pricing
  "isFree": false,
  "ticketPrice": "From $299",
  "ticketUrl": "https://eventbrite.com/e/.../register",

  // Enrichment
  "imageUrl": "https://cdn.evbstatic.com/...",
  "organizer": "TechCrunch",
  "speakers": [
    { "name": "Jane Doe", "title": "CEO", "company": "StartupXYZ" }
  ],
  "tags": ["AI", "startups", "venture capital"],
  "language": "en",

  // Provenance
  "source": "eventbrite",
  "scrapedAt": "2026-04-23T10:00:00Z"
}
```

### WordPress Plugin Compatibility

The following fields map directly to what `class-apify-fetcher.php` reads:

| Plugin reads | Actor outputs | Status |
|---|---|---|
| `name` / `title` | `name` | ✅ |
| `url` / `link` / `eventUrl` | `url` | ✅ |
| `start.utc` / `startAt` | `startAt` | ✅ |
| `description` / `summary` | `description` | ✅ |
| `location` (string) | `location` | ✅ |
| `venue.address.city` | `venue.city` | ✅ |
| `isOnline` / `is_online` | `isOnline` | ✅ |
| `ticketAvailability` | `ticketPrice` | ✅ |

Zero changes required to `class-apify-fetcher.php`.

---

## Filter Pipeline

Filters are applied after normalization, before dedup. Each filter is an independent predicate function in `filters.ts`:

| Filter | Logic |
|---|---|
| `filterByKeyword` | Case-insensitive match against `name` + `description` + `tags` |
| `filterByLocation` | If city/country: case-insensitive substring match on `venue.city`/`venue.country`. If lat/lng/radius: haversine distance ≤ radiusKm |
| `filterByDate` | `startAt >= dateFrom && startAt <= dateTo` |
| `filterByEventType` | `format` field matches any value in `eventTypes` |
| `filterByIndustry` | Any value in `industries` appears in `description` or `tags` (case-insensitive) |
| `filterByFormat` | `isOnline === true` (online) or `isOnline === false` (in-person) or pass (both) |
| `filterByPrice` | `isFree === true` (free) or `isFree === false` (paid) or pass (both) |
| `filterByLanguage` | `language` field matches ISO code, or field is null (pass-through) |

---

## Error Handling & Resilience

- Each scraper runs independently — one failure does not block others
- Network errors: retry 3× with exponential backoff via Apify SDK `RequestQueue`
- HTTP 429: respect `Retry-After` header, pause that source, continue others
- Per-item parse errors: log + skip, never crash the run
- Playwright timeouts: 15s `waitForSelector`, proceed with whatever loaded
- Actor always exits success; partial results are reported with per-source stats
- Anti-bot for Playwright sources: randomized delays (500–2000ms), real browser headers
- Final run log: `{ source, fetched, filtered, errors }` per source

---

## Testing Strategy

| Layer | Tool | Approach |
|---|---|---|
| Normalizer | vitest | Raw fixture JSON → assert unified EventItem fields |
| Filter predicates | vitest | Edge cases: timezone boundaries, radius math, partial matches |
| Deduplicator | vitest | Same event from 2 sources → exactly 1 output item |
| Scrapers | vitest + nock / Playwright route interception | Recorded HTTP fixtures — no live network calls |
| Integration | Manual + Apify test run | 1 result per source against live sites |

Fixtures stored in `src/scrapers/__fixtures__/` — one JSON file per source.

---

## Plugin/Theme Bug Fixes (Included in Scope)

Two field-name mismatches in `ft-autopublisher` prevent event cards from displaying location and date even when data exists. Fix is two line changes:

| File | Bug | Fix |
|---|---|---|
| `themes/founders-times/inc/card-radar-event.php` line ~13 | Reads `event_date` | Change to `radar_date` |
| `themes/founders-times/inc/card-radar-event.php` line ~11 | Reads `event_location` | Change to `location` |

---

## Apify Store Metadata

- **Actor name:** `event-scraper`
- **Display name:** Event Scraper — Eventbrite, Meetup, Lu.ma & More
- **Categories:** `SCRAPING`, `MARKETING`
- **Input schema:** Auto-generated UI form from `.actor/input_schema.json`
- **README:** Cover all 8 filters, output schema, WordPress integration example, rate limits

---

## Open Questions

None — all decisions made and approved.
