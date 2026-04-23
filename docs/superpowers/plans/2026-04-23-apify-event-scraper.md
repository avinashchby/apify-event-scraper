# Apify Event Scraper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Apify actor that scrapes events from 6 platforms (Eventbrite, Meetup, Lu.ma, Partiful, Hopin, Humanitix), applies 8 filter dimensions, deduplicates across sources, and outputs a unified EventItem schema compatible with the ft-autopublisher WordPress plugin.

**Architecture:** One modular scraper class per source (Cheerio × 4, Playwright × 2), shared normalisation utilities, a composable filter pipeline, and URL+title deduplication. All scrapers accept a dependency-injected `fetchFn` for unit testing with no live network calls.

**Tech Stack:** TypeScript 5, Node.js 18+, Apify SDK v3, Cheerio v1, Playwright v1, Vitest v1

---

## File Map

| File | Responsibility |
|---|---|
| `src/types.ts` | All shared TypeScript types: `InputSchema`, `EventItem`, `VenueInfo`, `SpeakerInfo`, `SourceId`, `EventFormat` |
| `src/utils/normalize.ts` | Shared helpers: `parseDate`, `stripHtml`, `detectFormat`, `buildLocation` |
| `src/filters.ts` | 8 filter predicates + `applyFilters(events, input)` |
| `src/deduplicator.ts` | `deduplicate(events)` — cross-source dedup by URL + title/date key |
| `src/scrapers/base.ts` | Abstract `BaseScraper` class — holds `input` + injected `fetch` |
| `src/scrapers/eventbrite.ts` | Cheerio scraper, parses JSON-LD from SSR search pages |
| `src/scrapers/meetup.ts` | GraphQL API scraper (public endpoint, no auth) |
| `src/scrapers/hopin.ts` | Cheerio scraper |
| `src/scrapers/humanitix.ts` | Cheerio scraper |
| `src/scrapers/luma.ts` | Playwright scraper; exposes `normalizeResponse()` for unit testing |
| `src/scrapers/partiful.ts` | Playwright scraper; exposes `normalizeResponse()` for unit testing |
| `src/scrapers/__fixtures__/eventbrite.html` | Recorded Eventbrite search HTML with JSON-LD |
| `src/scrapers/__fixtures__/meetup.json` | Recorded Meetup GraphQL response |
| `src/scrapers/__fixtures__/hopin.html` | Recorded Hopin search HTML |
| `src/scrapers/__fixtures__/humanitix.html` | Recorded Humanitix search HTML |
| `src/scrapers/__fixtures__/luma.json` | Recorded Lu.ma discover API response |
| `src/scrapers/__fixtures__/partiful.json` | Recorded Partiful explore API response |
| `src/main.ts` | Actor entry point — reads input, runs scrapers in parallel, filters, deduplicates, writes dataset |
| `.actor/actor.json` | Apify Store metadata |
| `.actor/input_schema.json` | Apify Store UI form definition |

**Modified (plugin bug fix — separate local WordPress install):**

| File | Change |
|---|---|
| `/Users/avinashchaubey/Local Sites/founderstimes/app/public/wp-content/themes/founders-times/inc/card-radar-event.php` | `event_date` → `radar_date`, `event_location` → `location` |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.actor/` (empty dir for now)

- [ ] **Step 1: Initialise project files**

Create `package.json`:
```json
{
  "name": "apify-event-scraper",
  "version": "1.0.0",
  "description": "Scrape events from Eventbrite, Meetup, Lu.ma, Partiful, Hopin, and Humanitix with 8 filter dimensions",
  "main": "dist/main.js",
  "scripts": {
    "start": "node dist/main.js",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "apify": "^3.2.0",
    "cheerio": "^1.0.0",
    "playwright": "^1.44.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
});
```

- [ ] **Step 2: Install dependencies**

```bash
cd /Users/avinashchaubey/Applications/apify-event-scrapper
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create directory structure**

```bash
mkdir -p src/scrapers/__fixtures__ src/utils .actor
```

- [ ] **Step 4: Commit scaffold**

```bash
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold TypeScript Apify actor project"
```

---

## Task 2: Core Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export type SourceId = 'eventbrite' | 'meetup' | 'luma' | 'partiful' | 'hopin' | 'humanitix';
export type EventFormat = 'conference' | 'meetup' | 'workshop' | 'hackathon' | 'webinar' | 'summit' | 'other';
export type FormatFilter = 'online' | 'in-person' | 'both';
export type PriceFilter = 'free' | 'paid' | 'both';

export interface LocationInput {
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface InputSchema {
  sources: SourceId[];
  query?: string;
  location?: LocationInput;
  dateFrom?: string;
  dateTo?: string;
  eventTypes?: EventFormat[];
  industries?: string[];
  format?: FormatFilter;
  priceType?: PriceFilter;
  language?: string;
  maxResults: number;
  maxResultsPerSource: number;
}

export interface VenueInfo {
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface SpeakerInfo {
  name: string;
  title?: string;
  company?: string;
}

export interface EventItem {
  name: string;
  url: string;
  startAt: string;
  endDate?: string;
  description: string;
  location: string;
  venue?: VenueInfo;
  isOnline: boolean;
  format: EventFormat;
  isFree: boolean;
  ticketPrice?: string;
  ticketUrl?: string;
  imageUrl?: string;
  organizer?: string;
  speakers?: SpeakerInfo[];
  tags?: string[];
  language?: string;
  source: SourceId;
  scrapedAt: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add core TypeScript types"
```

---

## Task 3: Normalisation Helpers + Tests

**Files:**
- Create: `src/utils/normalize.ts`
- Create: `src/utils/normalize.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/utils/normalize.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { parseDate, stripHtml, detectFormat, buildLocation } from './normalize';

describe('parseDate', () => {
  it('parses ISO string', () => {
    expect(parseDate('2026-06-15T09:00:00Z')).toBe('2026-06-15T09:00:00.000Z');
  });

  it('parses Meetup millisecond timestamp', () => {
    const ms = new Date('2026-06-20T18:30:00Z').getTime(); // > 1e10
    const result = parseDate(ms);
    expect(result).toBe('2026-06-20T18:30:00.000Z');
  });

  it('parses date-only string', () => {
    const result = parseDate('2026-06-15');
    expect(result).toMatch(/^2026-06-15/);
  });

  it('returns fallback ISO string for invalid input', () => {
    const result = parseDate('not-a-date');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('collapses multiple spaces', () => {
    expect(stripHtml('<p>  a  </p>')).toBe('a');
  });

  it('handles HTML entities', () => {
    expect(stripHtml('Hello &amp; world')).toBe('Hello world');
  });
});

describe('detectFormat', () => {
  it('detects hackathon', () => {
    expect(detectFormat('Global AI Hackathon', '')).toBe('hackathon');
  });

  it('detects conference', () => {
    expect(detectFormat('TechCrunch Disrupt Conference', '')).toBe('conference');
  });

  it('detects webinar', () => {
    expect(detectFormat('Marketing Webinar Series', '')).toBe('webinar');
  });

  it('detects meetup from description', () => {
    expect(detectFormat('Monthly Gathering', 'This is our monthly meet-up for builders')).toBe('meetup');
  });

  it('defaults to other', () => {
    expect(detectFormat('Random Event', 'No keywords here')).toBe('other');
  });
});

describe('buildLocation', () => {
  it('builds city, country string', () => {
    expect(buildLocation('San Francisco', 'US')).toBe('San Francisco, US');
  });

  it('handles missing country', () => {
    expect(buildLocation('London', undefined)).toBe('London');
  });

  it('handles both missing', () => {
    expect(buildLocation(undefined, undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/utils/normalize.test.ts
```

Expected: FAIL — `Cannot find module './normalize'`

- [ ] **Step 3: Implement `src/utils/normalize.ts`**

```typescript
import type { EventFormat } from '../types';

export function parseDate(raw: string | number): string {
  if (typeof raw === 'number') {
    const ms = raw > 1e10 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectFormat(title: string, description: string): EventFormat {
  const text = `${title} ${description}`.toLowerCase();
  if (/\bhackathon\b/.test(text)) return 'hackathon';
  if (/\bwebinar\b/.test(text)) return 'webinar';
  if (/\bworkshop\b/.test(text)) return 'workshop';
  if (/\bsummit\b/.test(text)) return 'summit';
  if (/\bconference\b|\bconf\b|\bsymposium\b/.test(text)) return 'conference';
  if (/\bmeetup\b|\bmeet[- ]up\b/.test(text)) return 'meetup';
  return 'other';
}

export function buildLocation(city?: string, country?: string): string {
  return [city, country].filter(Boolean).join(', ');
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/utils/normalize.test.ts
```

Expected: PASS — 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/normalize.ts src/utils/normalize.test.ts
git commit -m "feat: add normalisation helpers with tests"
```

---

## Task 4: Filter Pipeline + Tests

**Files:**
- Create: `src/filters.ts`
- Create: `src/filters.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/filters.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  filterByKeyword,
  filterByLocation,
  filterByDate,
  filterByEventType,
  filterByIndustry,
  filterByFormat,
  filterByPrice,
  filterByLanguage,
  applyFilters,
} from './filters';
import type { EventItem, InputSchema } from './types';

const baseEvent: EventItem = {
  name: 'AI Summit 2026',
  url: 'https://example.com/event/1',
  startAt: '2026-06-15T09:00:00.000Z',
  description: 'A conference about artificial intelligence and machine learning.',
  location: 'San Francisco, US',
  venue: { city: 'San Francisco', country: 'US', lat: 37.7749, lng: -122.4194 },
  isOnline: false,
  format: 'conference',
  isFree: false,
  ticketPrice: 'From $299',
  tags: ['AI', 'machine learning'],
  language: 'en',
  source: 'eventbrite',
  scrapedAt: '2026-04-23T10:00:00.000Z',
};

describe('filterByKeyword', () => {
  it('matches keyword in name', () => {
    expect(filterByKeyword('AI Summit')(baseEvent)).toBe(true);
  });

  it('matches keyword in description', () => {
    expect(filterByKeyword('machine learning')(baseEvent)).toBe(true);
  });

  it('matches keyword in tags', () => {
    expect(filterByKeyword('machine learning')(baseEvent)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(filterByKeyword('ai summit')(baseEvent)).toBe(true);
  });

  it('rejects non-matching keyword', () => {
    expect(filterByKeyword('blockchain')(baseEvent)).toBe(false);
  });
});

describe('filterByLocation (city/country)', () => {
  it('matches city substring', () => {
    expect(filterByLocation({ city: 'San Francisco' })(baseEvent)).toBe(true);
  });

  it('is case-insensitive for city', () => {
    expect(filterByLocation({ city: 'san francisco' })(baseEvent)).toBe(true);
  });

  it('rejects different city', () => {
    expect(filterByLocation({ city: 'London' })(baseEvent)).toBe(false);
  });

  it('matches country', () => {
    expect(filterByLocation({ country: 'US' })(baseEvent)).toBe(true);
  });
});

describe('filterByLocation (radius)', () => {
  it('passes event within radius', () => {
    // Same coords → 0 km distance
    const fn = filterByLocation({ lat: 37.7749, lng: -122.4194, radiusKm: 10 });
    expect(fn(baseEvent)).toBe(true);
  });

  it('rejects event outside radius', () => {
    // London coords → far from SF
    const fn = filterByLocation({ lat: 51.5074, lng: -0.1278, radiusKm: 50 });
    expect(fn(baseEvent)).toBe(false);
  });

  it('rejects event with no venue coordinates', () => {
    const noCoords = { ...baseEvent, venue: { city: 'SF' } };
    const fn = filterByLocation({ lat: 37.7749, lng: -122.4194, radiusKm: 50 });
    expect(fn(noCoords)).toBe(false);
  });
});

describe('filterByDate', () => {
  it('passes event in range', () => {
    expect(filterByDate('2026-06-01', '2026-06-30')(baseEvent)).toBe(true);
  });

  it('rejects event before range', () => {
    expect(filterByDate('2026-07-01', '2026-07-31')(baseEvent)).toBe(false);
  });

  it('rejects event after range', () => {
    expect(filterByDate('2026-01-01', '2026-05-31')(baseEvent)).toBe(false);
  });

  it('passes with no dateFrom', () => {
    expect(filterByDate(undefined, '2026-12-31')(baseEvent)).toBe(true);
  });
});

describe('filterByEventType', () => {
  it('passes matching format', () => {
    expect(filterByEventType(['conference', 'meetup'])(baseEvent)).toBe(true);
  });

  it('rejects non-matching format', () => {
    expect(filterByEventType(['hackathon', 'webinar'])(baseEvent)).toBe(false);
  });
});

describe('filterByIndustry', () => {
  it('matches industry in description', () => {
    expect(filterByIndustry(['artificial intelligence'])(baseEvent)).toBe(true);
  });

  it('matches industry in tags', () => {
    expect(filterByIndustry(['AI'])(baseEvent)).toBe(true);
  });

  it('rejects unmatched industry', () => {
    expect(filterByIndustry(['Fintech', 'Healthtech'])(baseEvent)).toBe(false);
  });
});

describe('filterByFormat', () => {
  it('passes in-person event for in-person filter', () => {
    expect(filterByFormat('in-person')(baseEvent)).toBe(true);
  });

  it('rejects in-person event for online filter', () => {
    expect(filterByFormat('online')(baseEvent)).toBe(false);
  });

  it('passes online event for online filter', () => {
    const online = { ...baseEvent, isOnline: true };
    expect(filterByFormat('online')(online)).toBe(true);
  });
});

describe('filterByPrice', () => {
  it('rejects paid event for free filter', () => {
    expect(filterByPrice('free')(baseEvent)).toBe(false);
  });

  it('passes free event for free filter', () => {
    const free = { ...baseEvent, isFree: true };
    expect(filterByPrice('free')(free)).toBe(true);
  });

  it('passes paid event for paid filter', () => {
    expect(filterByPrice('paid')(baseEvent)).toBe(true);
  });
});

describe('filterByLanguage', () => {
  it('passes matching language', () => {
    expect(filterByLanguage('en')(baseEvent)).toBe(true);
  });

  it('rejects non-matching language', () => {
    expect(filterByLanguage('es')(baseEvent)).toBe(false);
  });

  it('passes event with no language field', () => {
    const noLang = { ...baseEvent, language: undefined };
    expect(filterByLanguage('en')(noLang)).toBe(true);
  });
});

describe('applyFilters', () => {
  const input: InputSchema = {
    sources: ['eventbrite'],
    query: 'AI',
    format: 'in-person',
    priceType: 'both',
    maxResults: 200,
    maxResultsPerSource: 50,
  };

  it('applies multiple filters and returns matching events', () => {
    const result = applyFilters([baseEvent], input);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no events match', () => {
    const result = applyFilters([{ ...baseEvent, name: 'Blockchain Summit' }], input);
    expect(result).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/filters.test.ts
```

Expected: FAIL — `Cannot find module './filters'`

- [ ] **Step 3: Implement `src/filters.ts`**

```typescript
import type { EventItem, InputSchema, EventFormat, LocationInput } from './types';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterByKeyword(query: string): (e: EventItem) => boolean {
  const q = query.toLowerCase();
  return (e) => {
    const text = `${e.name} ${e.description} ${(e.tags ?? []).join(' ')}`.toLowerCase();
    return text.includes(q);
  };
}

export function filterByLocation(loc: LocationInput): (e: EventItem) => boolean {
  return (e) => {
    if (loc.lat !== undefined && loc.lng !== undefined && loc.radiusKm !== undefined) {
      const vLat = e.venue?.lat;
      const vLng = e.venue?.lng;
      if (vLat === undefined || vLng === undefined) return false;
      return haversineKm(loc.lat, loc.lng, vLat, vLng) <= loc.radiusKm;
    }
    if (loc.city) {
      const city = (e.venue?.city ?? '').toLowerCase();
      if (!city.includes(loc.city.toLowerCase())) return false;
    }
    if (loc.country) {
      const country = (e.venue?.country ?? '').toLowerCase();
      if (!country.includes(loc.country.toLowerCase())) return false;
    }
    return true;
  };
}

export function filterByDate(dateFrom?: string, dateTo?: string): (e: EventItem) => boolean {
  const from = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
  const to = dateTo ? new Date(`${dateTo}T23:59:59Z`).getTime() : Infinity;
  return (e) => {
    const t = new Date(e.startAt).getTime();
    return t >= from && t <= to;
  };
}

export function filterByEventType(types: EventFormat[]): (e: EventItem) => boolean {
  return (e) => types.includes(e.format);
}

export function filterByIndustry(industries: string[]): (e: EventItem) => boolean {
  return (e) => {
    const text = `${e.description} ${(e.tags ?? []).join(' ')}`.toLowerCase();
    return industries.some((ind) => text.includes(ind.toLowerCase()));
  };
}

export function filterByFormat(format: 'online' | 'in-person'): (e: EventItem) => boolean {
  return (e) => (format === 'online' ? e.isOnline : !e.isOnline);
}

export function filterByPrice(priceType: 'free' | 'paid'): (e: EventItem) => boolean {
  return (e) => (priceType === 'free' ? e.isFree : !e.isFree);
}

export function filterByLanguage(language: string): (e: EventItem) => boolean {
  const lang = language.toLowerCase();
  return (e) => !e.language || e.language.toLowerCase() === lang;
}

export function applyFilters(events: EventItem[], input: InputSchema): EventItem[] {
  let result = [...events];
  if (input.query) result = result.filter(filterByKeyword(input.query));
  if (input.location) result = result.filter(filterByLocation(input.location));
  if (input.dateFrom || input.dateTo) result = result.filter(filterByDate(input.dateFrom, input.dateTo));
  if (input.eventTypes?.length) result = result.filter(filterByEventType(input.eventTypes));
  if (input.industries?.length) result = result.filter(filterByIndustry(input.industries));
  if (input.format && input.format !== 'both') result = result.filter(filterByFormat(input.format));
  if (input.priceType && input.priceType !== 'both') result = result.filter(filterByPrice(input.priceType));
  if (input.language) result = result.filter(filterByLanguage(input.language));
  return result;
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/filters.test.ts
```

Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/filters.ts src/filters.test.ts
git commit -m "feat: add filter pipeline with 8 predicates and tests"
```

---

## Task 5: Deduplicator + Tests

**Files:**
- Create: `src/deduplicator.ts`
- Create: `src/deduplicator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/deduplicator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { deduplicate } from './deduplicator';
import type { EventItem } from './types';

const base: EventItem = {
  name: 'AI Summit 2026',
  url: 'https://eventbrite.com/e/ai-summit-123',
  startAt: '2026-06-15T09:00:00.000Z',
  description: 'A conference about AI.',
  location: 'San Francisco, US',
  isOnline: false,
  format: 'conference',
  isFree: false,
  source: 'eventbrite',
  scrapedAt: '2026-04-23T10:00:00.000Z',
};

describe('deduplicate', () => {
  it('keeps single event unchanged', () => {
    expect(deduplicate([base])).toHaveLength(1);
  });

  it('removes exact URL duplicate from different source', () => {
    const twin = { ...base, url: 'https://eventbrite.com/e/ai-summit-123', source: 'meetup' as const };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('removes duplicate with trailing slash in URL', () => {
    const twin = { ...base, url: 'https://eventbrite.com/e/ai-summit-123/', source: 'meetup' as const };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('removes duplicate with http vs https URL', () => {
    const twin = { ...base, url: 'http://eventbrite.com/e/ai-summit-123', source: 'hopin' as const };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('removes same title + date from different source', () => {
    const twin = {
      ...base,
      url: 'https://meetup.com/events/999',
      source: 'meetup' as const,
    };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('keeps events with same name but different dates', () => {
    const nextYear = { ...base, url: 'https://eventbrite.com/e/ai-summit-456', startAt: '2027-06-15T09:00:00.000Z' };
    expect(deduplicate([base, nextYear])).toHaveLength(2);
  });

  it('keeps first occurrence when deduplicating', () => {
    const twin = { ...base, source: 'meetup' as const };
    const result = deduplicate([base, twin]);
    expect(result[0].source).toBe('eventbrite');
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/deduplicator.test.ts
```

Expected: FAIL — `Cannot find module './deduplicator'`

- [ ] **Step 3: Implement `src/deduplicator.ts`**

```typescript
import type { EventItem } from './types';

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '').replace(/^https?:\/\//, '').toLowerCase();
}

function titleDateKey(name: string, startAt: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  const date = startAt.slice(0, 10);
  return `${slug}|${date}`;
}

export function deduplicate(events: EventItem[]): EventItem[] {
  const seenUrls = new Set<string>();
  const seenTitleDates = new Set<string>();
  const result: EventItem[] = [];

  for (const event of events) {
    const urlKey = normalizeUrl(event.url);
    const tdKey = titleDateKey(event.name, event.startAt);

    if (seenUrls.has(urlKey) || seenTitleDates.has(tdKey)) continue;

    seenUrls.add(urlKey);
    seenTitleDates.add(tdKey);
    result.push(event);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/deduplicator.test.ts
```

Expected: PASS — all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/deduplicator.ts src/deduplicator.test.ts
git commit -m "feat: add cross-source deduplicator with tests"
```

---

## Task 6: Base Scraper Class

**Files:**
- Create: `src/scrapers/base.ts`

- [ ] **Step 1: Write `src/scrapers/base.ts`**

```typescript
import type { InputSchema, EventItem } from '../types';

export interface ScraperOptions {
  input: InputSchema;
  fetchFn?: typeof globalThis.fetch;
}

export abstract class BaseScraper {
  protected input: InputSchema;
  protected fetch: typeof globalThis.fetch;

  constructor(options: ScraperOptions) {
    this.input = options.input;
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  abstract scrape(): Promise<EventItem[]>;

  protected get maxResults(): number {
    return this.input.maxResultsPerSource ?? 50;
  }

  /** Retry fn up to `retries` times with exponential backoff. */
  protected async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let lastError: Error = new Error('Unknown');
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    }
    throw lastError;
  }

  /** Random delay 500–2000 ms — use in Playwright scrapers to avoid bot detection. */
  protected async randomDelay(): Promise<void> {
    const ms = 500 + Math.random() * 1500;
    await new Promise((r) => setTimeout(r, ms));
  }
}
```

- [ ] **Step 2: Verify compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/scrapers/base.ts
git commit -m "feat: add abstract BaseScraper class"
```

---

## Task 7: Eventbrite Scraper + Fixture + Tests

**Files:**
- Create: `src/scrapers/__fixtures__/eventbrite.html`
- Create: `src/scrapers/eventbrite.ts`
- Create: `src/scrapers/eventbrite.test.ts`

- [ ] **Step 1: Create fixture**

Create `src/scrapers/__fixtures__/eventbrite.html`:
```html
<!DOCTYPE html>
<html><head>
<script type="application/ld+json">
[
  {
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "AI Summit San Francisco 2026",
    "url": "https://www.eventbrite.com/e/ai-summit-sf-2026-tickets-123456789",
    "startDate": "2026-06-15T09:00:00-07:00",
    "endDate": "2026-06-15T18:00:00-07:00",
    "description": "Join 500+ AI practitioners for a full day of talks and workshops on artificial intelligence.",
    "location": {
      "@type": "Place",
      "name": "Moscone Center",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "747 Howard St",
        "addressLocality": "San Francisco",
        "addressCountry": "US"
      },
      "geo": { "latitude": 37.7845, "longitude": -122.4026 }
    },
    "image": "https://img.evbuc.com/ai-summit.jpg",
    "organizer": { "@type": "Organization", "name": "AI Events LLC" },
    "offers": { "@type": "Offer", "price": "299", "priceCurrency": "USD" },
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode"
  }
]
</script>
</head><body></body></html>
```

- [ ] **Step 2: Write failing test**

Create `src/scrapers/eventbrite.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventbriteScraper } from './eventbrite';

const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__/eventbrite.html'),
  'utf-8'
);

const mockInput = {
  sources: ['eventbrite' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

function makeMockFetch(body: string, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

describe('EventbriteScraper', () => {
  it('parses fixture HTML into EventItem[]', async () => {
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch(fixtureHtml) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('AI Summit San Francisco 2026');
    expect(events[0].url).toBe('https://www.eventbrite.com/e/ai-summit-sf-2026-tickets-123456789');
    expect(events[0].startAt).toMatch(/^2026-06-15/);
    expect(events[0].source).toBe('eventbrite');
    expect(events[0].venue?.city).toBe('San Francisco');
    expect(events[0].venue?.country).toBe('US');
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(false);
    expect(events[0].ticketPrice).toContain('299');
    expect(events[0].organizer).toBe('AI Events LLC');
    expect(events[0].imageUrl).toBe('https://img.evbuc.com/ai-summit.jpg');
  });

  it('skips entries without @type Event', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
      [{"@type":"Organization","name":"test"}]
      </script></head><body></body></html>`;
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch(html) });
    expect(await scraper.scrape()).toHaveLength(0);
  });

  it('throws on non-200 response', async () => {
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch('', 403) });
    await expect(scraper.scrape()).rejects.toThrow('Eventbrite HTTP 403');
  });

  it('parses inline (non-array) JSON-LD', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Event",
        "name": "Solo Event",
        "url": "https://eventbrite.com/e/solo-1",
        "startDate": "2026-07-01T10:00:00Z",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode"
      }
      </script></head><body></body></html>`;
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch(html) });
    const events = await scraper.scrape();
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Solo Event');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/scrapers/eventbrite.test.ts
```

Expected: FAIL — `Cannot find module './eventbrite'`

- [ ] **Step 4: Implement `src/scrapers/eventbrite.ts`**

```typescript
import * as cheerio from 'cheerio';
import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface EventbriteJsonLd {
  '@type': string;
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  location?: {
    name?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      addressCountry?: string;
    };
    geo?: { latitude?: number; longitude?: number };
  };
  image?: string | string[];
  organizer?: { name?: string };
  offers?: { price?: string; priceCurrency?: string };
  eventAttendanceMode?: string;
}

export class EventbriteScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    return this.withRetry(async () => {
      const url = this.buildUrl();
      const res = await this.fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (res.status === 429) throw new Error(`Eventbrite rate limited`);
      if (!res.ok) throw new Error(`Eventbrite HTTP ${res.status}`);
      return this.parseEvents(await res.text());
    });
  }

  private buildUrl(): string {
    const loc = this.input.location;
    const place =
      loc?.city && loc?.country
        ? `${loc.country.toLowerCase()}--${loc.city.toLowerCase().replace(/\s+/g, '-')}`
        : 'worldwide';
    const params = new URLSearchParams();
    if (this.input.query) params.set('q', this.input.query);
    if (this.input.dateFrom) params.set('start_date', this.input.dateFrom);
    if (this.input.dateTo) params.set('end_date', this.input.dateTo);
    return `https://www.eventbrite.com/d/${place}/events/?${params.toString()}`;
  }

  parseEvents(html: string): EventItem[] {
    const $ = cheerio.load(html);
    const items: EventItem[] = [];
    const now = new Date().toISOString();

    $('script[type="application/ld+json"]').each((_, el) => {
      if (items.length >= this.maxResults) return false;
      try {
        const raw: unknown = JSON.parse($(el).html() ?? '{}');
        const entries = Array.isArray(raw) ? raw : [raw];
        for (const ev of entries as EventbriteJsonLd[]) {
          if (ev['@type'] !== 'Event' || !ev.name || !ev.url || !ev.startDate) continue;
          const item = this.normalizeEntry(ev, now);
          if (item) items.push(item);
        }
      } catch {
        // malformed JSON-LD — skip
      }
    });

    return items;
  }

  private normalizeEntry(ev: EventbriteJsonLd, scrapedAt: string): EventItem | null {
    if (!ev.startDate) return null;
    const city = ev.location?.address?.addressLocality;
    const country = ev.location?.address?.addressCountry;
    const venue: VenueInfo = {
      name: ev.location?.name,
      address: ev.location?.address?.streetAddress,
      city,
      country,
      lat: ev.location?.geo?.latitude,
      lng: ev.location?.geo?.longitude,
    };
    const isOnline = ev.eventAttendanceMode?.includes('OnlineEventAttendanceMode') ?? false;
    const priceStr = ev.offers?.price;
    const isFree = !priceStr || priceStr === '0' || priceStr.toLowerCase() === 'free';
    const image = Array.isArray(ev.image) ? ev.image[0] : ev.image;
    const desc = stripHtml(ev.description ?? '');

    return {
      name: ev.name!,
      url: ev.url!,
      startAt: parseDate(ev.startDate),
      endDate: ev.endDate ? parseDate(ev.endDate) : undefined,
      description: desc,
      location: buildLocation(city, country),
      venue,
      isOnline,
      format: detectFormat(ev.name!, desc),
      isFree,
      ticketPrice: isFree
        ? 'Free'
        : priceStr
        ? `${priceStr} ${ev.offers?.priceCurrency ?? ''}`.trim()
        : undefined,
      ticketUrl: ev.url,
      imageUrl: image,
      organizer: ev.organizer?.name,
      source: 'eventbrite',
      scrapedAt,
    };
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npx vitest run src/scrapers/eventbrite.test.ts
```

Expected: PASS — all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/eventbrite.ts src/scrapers/eventbrite.test.ts src/scrapers/__fixtures__/eventbrite.html
git commit -m "feat: add Eventbrite Cheerio scraper with JSON-LD parsing"
```

---

## Task 8: Meetup Scraper + Fixture + Tests

**Files:**
- Create: `src/scrapers/__fixtures__/meetup.json`
- Create: `src/scrapers/meetup.ts`
- Create: `src/scrapers/meetup.test.ts`

- [ ] **Step 1: Create fixture**

Create `src/scrapers/__fixtures__/meetup.json`:
```json
{
  "data": {
    "keywordSearch": {
      "edges": [
        {
          "node": {
            "id": "meetup-123456",
            "title": "SF AI Builders Monthly Meetup",
            "dateTime": "2026-06-20T18:30:00",
            "endTime": "2026-06-20T21:00:00",
            "description": "<p>Monthly gathering of AI builders in SF. Share projects, demo, network.</p>",
            "eventUrl": "https://www.meetup.com/sf-ai-builders/events/123456789/",
            "isOnline": false,
            "venue": {
              "name": "GitHub HQ",
              "city": "San Francisco",
              "state": "CA",
              "country": "us",
              "lat": 37.7749,
              "lon": -122.4194
            },
            "feeSettings": null,
            "group": { "name": "SF AI Builders" },
            "featuredEventPhoto": {
              "highResUrl": "https://secure.meetupstatic.com/photos/event/123.jpg"
            }
          }
        }
      ],
      "pageInfo": { "endCursor": "abc123", "hasNextPage": false }
    }
  }
}
```

- [ ] **Step 2: Write failing test**

Create `src/scrapers/meetup.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MeetupScraper } from './meetup';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/meetup.json'), 'utf-8')
);

const mockInput = {
  sources: ['meetup' as const],
  query: 'AI',
  maxResults: 200,
  maxResultsPerSource: 50,
};

function makeMockFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('MeetupScraper', () => {
  it('parses fixture into EventItem[]', async () => {
    const scraper = new MeetupScraper({ input: mockInput, fetchFn: makeMockFetch(fixture) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('SF AI Builders Monthly Meetup');
    expect(events[0].url).toBe('https://www.meetup.com/sf-ai-builders/events/123456789/');
    expect(events[0].source).toBe('meetup');
    expect(events[0].venue?.city).toBe('San Francisco');
    expect(events[0].venue?.lat).toBe(37.7749);
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(true);
    expect(events[0].organizer).toBe('SF AI Builders');
    expect(events[0].description).not.toContain('<p>');
  });

  it('handles paid event with fee settings', async () => {
    const paid = {
      ...fixture,
      data: {
        keywordSearch: {
          edges: [{
            node: {
              ...fixture.data.keywordSearch.edges[0].node,
              feeSettings: { amount: 25, currency: 'USD' },
            },
          }],
          pageInfo: { hasNextPage: false },
        },
      },
    };
    const scraper = new MeetupScraper({ input: mockInput, fetchFn: makeMockFetch(paid) });
    const events = await scraper.scrape();
    expect(events[0].isFree).toBe(false);
    expect(events[0].ticketPrice).toContain('25');
  });

  it('throws on HTTP error', async () => {
    const scraper = new MeetupScraper({ input: mockInput, fetchFn: makeMockFetch({}, 500) });
    await expect(scraper.scrape()).rejects.toThrow('Meetup HTTP 500');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/scrapers/meetup.test.ts
```

Expected: FAIL — `Cannot find module './meetup'`

- [ ] **Step 4: Implement `src/scrapers/meetup.ts`**

```typescript
import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

const GRAPHQL_URL = 'https://api.meetup.com/gql';

const SEARCH_QUERY = `
query SearchEvents($query: String!, $lat: Float, $lon: Float, $radius: Int) {
  keywordSearch(
    filter: { query: $query, lat: $lat, lon: $lon, radius: $radius }
    input: { first: 50 }
    sort: { sortField: DATETIME }
  ) {
    edges {
      node {
        ... on Event {
          id
          title
          dateTime
          endTime
          description
          eventUrl
          isOnline
          venue { name city state country lat lon }
          feeSettings { amount currency }
          group { name }
          featuredEventPhoto { highResUrl }
        }
      }
    }
    pageInfo { endCursor hasNextPage }
  }
}`;

interface MeetupEvent {
  id: string;
  title: string;
  dateTime: string;
  endTime?: string;
  description?: string;
  eventUrl: string;
  isOnline: boolean;
  venue?: { name?: string; city?: string; state?: string; country?: string; lat?: number; lon?: number };
  feeSettings?: { amount?: number; currency?: string } | null;
  group?: { name?: string };
  featuredEventPhoto?: { highResUrl?: string };
}

interface MeetupResponse {
  data?: {
    keywordSearch?: {
      edges?: { node?: MeetupEvent }[];
    };
  };
}

export class MeetupScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const loc = this.input.location;
    const variables: Record<string, unknown> = {
      query: this.input.query ?? '',
      lat: loc?.lat,
      lon: loc?.lng,
      radius: loc?.radiusKm ? Math.round(loc.radiusKm * 0.621371) : undefined,
    };

    const res = await this.fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: SEARCH_QUERY, variables }),
    });

    if (!res.ok) throw new Error(`Meetup HTTP ${res.status}`);

    const json = (await res.json()) as MeetupResponse;
    const edges = json.data?.keywordSearch?.edges ?? [];
    const now = new Date().toISOString();

    return edges
      .map((e) => e.node)
      .filter((n): n is MeetupEvent => !!n?.eventUrl)
      .slice(0, this.maxResults)
      .map((ev) => this.normalizeEvent(ev, now));
  }

  private normalizeEvent(ev: MeetupEvent, scrapedAt: string): EventItem {
    const city = ev.venue?.city;
    const country = ev.venue?.country?.toUpperCase();
    const venue: VenueInfo = {
      name: ev.venue?.name,
      city,
      country,
      lat: ev.venue?.lat,
      lng: ev.venue?.lon,
    };
    const desc = stripHtml(ev.description ?? '');
    const isFree = !ev.feeSettings?.amount || ev.feeSettings.amount === 0;

    return {
      name: ev.title,
      url: ev.eventUrl,
      startAt: parseDate(ev.dateTime),
      endDate: ev.endTime ? parseDate(ev.endTime) : undefined,
      description: desc,
      location: buildLocation(city, country),
      venue,
      isOnline: ev.isOnline,
      format: detectFormat(ev.title, desc),
      isFree,
      ticketPrice: isFree
        ? 'Free'
        : `${ev.feeSettings?.amount ?? ''} ${ev.feeSettings?.currency ?? ''}`.trim(),
      imageUrl: ev.featuredEventPhoto?.highResUrl,
      organizer: ev.group?.name,
      source: 'meetup',
      scrapedAt,
    };
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npx vitest run src/scrapers/meetup.test.ts
```

Expected: PASS — all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/meetup.ts src/scrapers/meetup.test.ts src/scrapers/__fixtures__/meetup.json
git commit -m "feat: add Meetup GraphQL scraper with tests"
```

---

## Task 9: Hopin Scraper + Fixture + Tests

**Files:**
- Create: `src/scrapers/__fixtures__/hopin.html`
- Create: `src/scrapers/hopin.ts`
- Create: `src/scrapers/hopin.test.ts`

> **Note:** Hopin's HTML structure must be verified against the live site at `https://hopin.to/events` before finalising selectors. The selectors below are based on known patterns; update them during implementation if the live DOM differs.

- [ ] **Step 1: Create fixture**

Create `src/scrapers/__fixtures__/hopin.html`:
```html
<!DOCTYPE html>
<html><head><title>Hopin Events</title></head>
<body>
  <div data-testid="event-card">
    <a href="/events/ai-product-summit-2026" data-testid="event-link">
      <h3 data-testid="event-name">AI Product Summit 2026</h3>
    </a>
    <time data-testid="event-date" datetime="2026-07-10T09:00:00Z">July 10, 2026</time>
    <span data-testid="event-location">London, UK</span>
    <p data-testid="event-description">The premier summit for AI product managers and builders.</p>
    <span data-testid="event-price">Free</span>
    <img data-testid="event-image" src="https://cdn.hopin.com/ai-product-summit.jpg" alt="AI Product Summit" />
  </div>
</body>
</html>
```

- [ ] **Step 2: Write failing test**

Create `src/scrapers/hopin.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HopinScraper } from './hopin';

const fixtureHtml = readFileSync(join(__dirname, '__fixtures__/hopin.html'), 'utf-8');

const mockInput = {
  sources: ['hopin' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

function makeMockFetch(body: string, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

describe('HopinScraper', () => {
  it('parses fixture HTML into EventItem[]', async () => {
    const scraper = new HopinScraper({ input: mockInput, fetchFn: makeMockFetch(fixtureHtml) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('AI Product Summit 2026');
    expect(events[0].url).toContain('hopin');
    expect(events[0].startAt).toMatch(/^2026-07-10/);
    expect(events[0].source).toBe('hopin');
    expect(events[0].isFree).toBe(true);
    expect(events[0].description).toContain('AI product managers');
  });

  it('throws on HTTP error', async () => {
    const scraper = new HopinScraper({ input: mockInput, fetchFn: makeMockFetch('', 403) });
    await expect(scraper.scrape()).rejects.toThrow('Hopin HTTP 403');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/scrapers/hopin.test.ts
```

Expected: FAIL — `Cannot find module './hopin'`

- [ ] **Step 4: Implement `src/scrapers/hopin.ts`**

```typescript
import * as cheerio from 'cheerio';
import type { EventItem } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

const BASE_URL = 'https://hopin.to';

export class HopinScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const params = new URLSearchParams();
    if (this.input.query) params.set('search', this.input.query);
    const url = `${BASE_URL}/events?${params.toString()}`;

    const res = await this.fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) throw new Error(`Hopin HTTP ${res.status}`);
    return this.parseEvents(await res.text());
  }

  parseEvents(html: string): EventItem[] {
    const $ = cheerio.load(html);
    const items: EventItem[] = [];
    const now = new Date().toISOString();

    $('[data-testid="event-card"]').each((_, el) => {
      if (items.length >= this.maxResults) return false;
      try {
        const name = $('[data-testid="event-name"]', el).text().trim();
        const href = $('[data-testid="event-link"]', el).attr('href') ?? '';
        const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        const dateStr = $('[data-testid="event-date"]', el).attr('datetime') ?? '';
        const locationStr = $('[data-testid="event-location"]', el).text().trim();
        const desc = stripHtml($('[data-testid="event-description"]', el).text().trim());
        const priceText = $('[data-testid="event-price"]', el).text().trim().toLowerCase();
        const imageUrl = $('[data-testid="event-image"]', el).attr('src');

        if (!name || !url || !dateStr) return;

        const [city, country] = locationStr.split(',').map((s) => s.trim());
        const isFree = priceText === 'free' || priceText === '';

        items.push({
          name,
          url,
          startAt: parseDate(dateStr),
          description: desc,
          location: locationStr || buildLocation(city, country),
          venue: { city, country },
          isOnline: false,
          format: detectFormat(name, desc),
          isFree,
          ticketPrice: isFree ? 'Free' : priceText || undefined,
          imageUrl,
          source: 'hopin',
          scrapedAt: now,
        });
      } catch {
        // skip malformed card
      }
    });

    return items;
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npx vitest run src/scrapers/hopin.test.ts
```

Expected: PASS — both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/hopin.ts src/scrapers/hopin.test.ts src/scrapers/__fixtures__/hopin.html
git commit -m "feat: add Hopin Cheerio scraper with tests"
```

---

## Task 10: Humanitix Scraper + Fixture + Tests

**Files:**
- Create: `src/scrapers/__fixtures__/humanitix.html`
- Create: `src/scrapers/humanitix.ts`
- Create: `src/scrapers/humanitix.test.ts`

> **Note:** Verify selectors against `https://humanitix.com/au/tickets` before finalising.

- [ ] **Step 1: Create fixture**

Create `src/scrapers/__fixtures__/humanitix.html`:
```html
<!DOCTYPE html>
<html><head><title>Humanitix Events</title></head>
<body>
  <div class="event-listing-card">
    <a class="event-card__link" href="/au/tickets/startup-summit-sydney-2026">
      <h2 class="event-card__title">Startup Summit Sydney 2026</h2>
    </a>
    <div class="event-card__date">2026-08-05T09:00:00+10:00</div>
    <div class="event-card__location">Sydney, AU</div>
    <div class="event-card__description">The biggest startup event in Australia this year.</div>
    <div class="event-card__price">From $49</div>
    <img class="event-card__image" src="https://cdn.humanitix.com/startup-summit.jpg" alt="Startup Summit" />
    <div class="event-card__organiser">TechSydney</div>
  </div>
</body>
</html>
```

- [ ] **Step 2: Write failing test**

Create `src/scrapers/humanitix.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HumanitixScraper } from './humanitix';

const fixtureHtml = readFileSync(join(__dirname, '__fixtures__/humanitix.html'), 'utf-8');

const mockInput = {
  sources: ['humanitix' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

function makeMockFetch(body: string, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

describe('HumanitixScraper', () => {
  it('parses fixture HTML into EventItem[]', async () => {
    const scraper = new HumanitixScraper({ input: mockInput, fetchFn: makeMockFetch(fixtureHtml) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Startup Summit Sydney 2026');
    expect(events[0].url).toContain('humanitix.com');
    expect(events[0].startAt).toMatch(/^2026-08-05/);
    expect(events[0].source).toBe('humanitix');
    expect(events[0].isFree).toBe(false);
    expect(events[0].organizer).toBe('TechSydney');
  });

  it('throws on HTTP error', async () => {
    const scraper = new HumanitixScraper({ input: mockInput, fetchFn: makeMockFetch('', 429) });
    await expect(scraper.scrape()).rejects.toThrow('Humanitix HTTP 429');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/scrapers/humanitix.test.ts
```

Expected: FAIL — `Cannot find module './humanitix'`

- [ ] **Step 4: Implement `src/scrapers/humanitix.ts`**

```typescript
import * as cheerio from 'cheerio';
import type { EventItem } from '../types';
import { parseDate, stripHtml, detectFormat } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

const BASE_URL = 'https://humanitix.com';

export class HumanitixScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const params = new URLSearchParams();
    if (this.input.query) params.set('search', this.input.query);
    const url = `${BASE_URL}/au/tickets?${params.toString()}`;

    const res = await this.fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html',
      },
    });
    if (!res.ok) throw new Error(`Humanitix HTTP ${res.status}`);
    return this.parseEvents(await res.text());
  }

  parseEvents(html: string): EventItem[] {
    const $ = cheerio.load(html);
    const items: EventItem[] = [];
    const now = new Date().toISOString();

    $('.event-listing-card').each((_, el) => {
      if (items.length >= this.maxResults) return false;
      try {
        const name = $('.event-card__title', el).text().trim();
        const href = $('.event-card__link', el).attr('href') ?? '';
        const url = href.startsWith('http') ? href : `${BASE_URL}${href}`;
        const dateStr = $('.event-card__date', el).text().trim();
        const locationStr = $('.event-card__location', el).text().trim();
        const desc = stripHtml($('.event-card__description', el).text().trim());
        const priceText = $('.event-card__price', el).text().trim().toLowerCase();
        const imageUrl = $('.event-card__image', el).attr('src');
        const organizer = $('.event-card__organiser', el).text().trim() || undefined;

        if (!name || !url || !dateStr) return;

        const [city, country] = locationStr.split(',').map((s) => s.trim());
        const isFree = priceText === 'free' || priceText === '';

        items.push({
          name,
          url,
          startAt: parseDate(dateStr),
          description: desc,
          location: locationStr,
          venue: { city, country },
          isOnline: false,
          format: detectFormat(name, desc),
          isFree,
          ticketPrice: isFree ? 'Free' : priceText || undefined,
          imageUrl,
          organizer,
          source: 'humanitix',
          scrapedAt: now,
        });
      } catch {
        // skip malformed card
      }
    });

    return items;
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npx vitest run src/scrapers/humanitix.test.ts
```

Expected: PASS — both tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/humanitix.ts src/scrapers/humanitix.test.ts src/scrapers/__fixtures__/humanitix.html
git commit -m "feat: add Humanitix Cheerio scraper with tests"
```

---

## Task 11: Lu.ma Scraper + Fixture + Tests

**Files:**
- Create: `src/scrapers/__fixtures__/luma.json`
- Create: `src/scrapers/luma.ts`
- Create: `src/scrapers/luma.test.ts`

> Lu.ma is a React SPA. The scraper uses Playwright to navigate to `https://lu.ma/discover`, intercepts the `/api/discover/search` XHR call, and extracts the JSON payload. The `normalizeResponse()` method is public so it can be unit-tested independently of the browser.

- [ ] **Step 1: Create fixture**

Create `src/scrapers/__fixtures__/luma.json`:
```json
{
  "entries": [
    {
      "event": {
        "api_id": "evt-luma-abc123",
        "name": "Founders & Investors Dinner SF",
        "url": "https://lu.ma/founders-dinner-sf-jun26",
        "start_at": "2026-06-18T19:00:00.000Z",
        "end_at": "2026-06-18T22:00:00.000Z",
        "description": "An intimate evening for founders and investors to connect over dinner and meaningful conversations.",
        "cover_url": "https://images.lumacdn.com/event-covers/founders-dinner.png",
        "location_type": "offline",
        "geo_address_json": {
          "city": "San Francisco",
          "country": "US",
          "full_address": "123 Main St, San Francisco, CA 94105",
          "latitude": 37.7749,
          "longitude": -122.4194
        },
        "ticket_info": {
          "is_free": false,
          "price": 4500,
          "currency": "USD"
        },
        "hosts": [
          { "name": "Jane Doe", "title": "Partner", "affiliation": "Sequoia Capital" }
        ]
      }
    }
  ]
}
```

- [ ] **Step 2: Write failing test**

Create `src/scrapers/luma.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LumaScraper } from './luma';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/luma.json'), 'utf-8')
);

const mockInput = {
  sources: ['luma' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

describe('LumaScraper.normalizeResponse', () => {
  it('normalizes fixture to EventItem[]', () => {
    const scraper = new LumaScraper({ input: mockInput });
    const events = scraper.normalizeResponse(fixture);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Founders & Investors Dinner SF');
    expect(events[0].url).toBe('https://lu.ma/founders-dinner-sf-jun26');
    expect(events[0].startAt).toMatch(/^2026-06-18/);
    expect(events[0].source).toBe('luma');
    expect(events[0].venue?.city).toBe('San Francisco');
    expect(events[0].venue?.country).toBe('US');
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(false);
    expect(events[0].speakers).toHaveLength(1);
    expect(events[0].speakers![0].name).toBe('Jane Doe');
  });

  it('handles online event', () => {
    const onlineFixture = {
      entries: [{
        event: {
          ...fixture.entries[0].event,
          location_type: 'online',
          geo_address_json: null,
        },
      }],
    };
    const scraper = new LumaScraper({ input: mockInput });
    const events = scraper.normalizeResponse(onlineFixture);
    expect(events[0].isOnline).toBe(true);
  });

  it('handles free event', () => {
    const freeFixture = {
      entries: [{
        event: {
          ...fixture.entries[0].event,
          ticket_info: { is_free: true },
        },
      }],
    };
    const scraper = new LumaScraper({ input: mockInput });
    const events = scraper.normalizeResponse(freeFixture);
    expect(events[0].isFree).toBe(true);
    expect(events[0].ticketPrice).toBe('Free');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/scrapers/luma.test.ts
```

Expected: FAIL — `Cannot find module './luma'`

- [ ] **Step 4: Implement `src/scrapers/luma.ts`**

```typescript
import { chromium } from 'playwright';
import type { EventItem, VenueInfo, SpeakerInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface LumaGeoAddress {
  city?: string;
  country?: string;
  full_address?: string;
  latitude?: number;
  longitude?: number;
}

interface LumaHost {
  name: string;
  title?: string;
  affiliation?: string;
}

interface LumaEvent {
  api_id: string;
  name: string;
  url: string;
  start_at: string;
  end_at?: string;
  description?: string;
  cover_url?: string;
  location_type?: string;
  geo_address_json?: LumaGeoAddress | null;
  ticket_info?: { is_free?: boolean; price?: number; currency?: string } | null;
  hosts?: LumaHost[];
}

interface LumaResponse {
  entries?: { event: LumaEvent }[];
}

export class LumaScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      let captured: LumaResponse | null = null;

      await page.route('**/api/discover/search**', async (route) => {
        const response = await route.fetch();
        try {
          captured = (await response.json()) as LumaResponse;
        } catch {
          captured = null;
        }
        await route.fulfill({ response });
      });

      const params = new URLSearchParams();
      if (this.input.query) params.set('query', this.input.query);
      if (this.input.location?.city) params.set('location', this.input.location.city);

      await this.randomDelay();
      await page.goto(`https://lu.ma/discover?${params.toString()}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait up to 5s for the API call to be captured
      const start = Date.now();
      while (!captured && Date.now() - start < 5000) {
        await page.waitForTimeout(200);
      }

      return captured ? this.normalizeResponse(captured) : [];
    } finally {
      await browser.close();
    }
  }

  normalizeResponse(data: LumaResponse): EventItem[] {
    const now = new Date().toISOString();
    return (data.entries ?? [])
      .slice(0, this.maxResults)
      .map(({ event: ev }) => {
        const geo = ev.geo_address_json;
        const isOnline = ev.location_type === 'online';
        const venue: VenueInfo | undefined = geo
          ? {
              address: geo.full_address,
              city: geo.city,
              country: geo.country,
              lat: geo.latitude,
              lng: geo.longitude,
            }
          : undefined;

        const isFree = ev.ticket_info?.is_free ?? true;
        const priceRaw = ev.ticket_info?.price;
        const currency = ev.ticket_info?.currency ?? 'USD';
        const priceFormatted = priceRaw ? `${(priceRaw / 100).toFixed(2)} ${currency}` : undefined;

        const speakers: SpeakerInfo[] = (ev.hosts ?? []).map((h) => ({
          name: h.name,
          title: h.title,
          company: h.affiliation,
        }));

        const desc = stripHtml(ev.description ?? '');

        return {
          name: ev.name,
          url: ev.url,
          startAt: parseDate(ev.start_at),
          endDate: ev.end_at ? parseDate(ev.end_at) : undefined,
          description: desc,
          location: buildLocation(geo?.city, geo?.country),
          venue,
          isOnline,
          format: detectFormat(ev.name, desc),
          isFree,
          ticketPrice: isFree ? 'Free' : priceFormatted,
          imageUrl: ev.cover_url,
          speakers: speakers.length ? speakers : undefined,
          source: 'luma' as const,
          scrapedAt: now,
        };
      });
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npx vitest run src/scrapers/luma.test.ts
```

Expected: PASS — all 3 tests pass. (Tests only call `normalizeResponse` — no browser launched.)

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/luma.ts src/scrapers/luma.test.ts src/scrapers/__fixtures__/luma.json
git commit -m "feat: add Lu.ma Playwright scraper with normalizer tests"
```

---

## Task 12: Partiful Scraper + Fixture + Tests

**Files:**
- Create: `src/scrapers/__fixtures__/partiful.json`
- Create: `src/scrapers/partiful.ts`
- Create: `src/scrapers/partiful.test.ts`

> Partiful is a React SPA. The scraper navigates to `https://partiful.com/explore`, intercepts `/api/events/search` or the equivalent XHR call (verify URL in browser DevTools), and extracts the JSON. `normalizeResponse()` is public for unit testing.

- [ ] **Step 1: Create fixture**

Create `src/scrapers/__fixtures__/partiful.json`:
```json
{
  "events": [
    {
      "id": "partiful-xyz789",
      "title": "NYC Founders Happy Hour",
      "eventUrl": "https://partiful.com/e/nyc-founders-happy-hour-jun26",
      "startTime": "2026-06-25T18:00:00.000Z",
      "endTime": "2026-06-25T21:00:00.000Z",
      "description": "Casual drinks and networking for NYC founders. All stages welcome.",
      "coverImage": "https://partiful-images.com/nyc-founders-cover.jpg",
      "isVirtual": false,
      "location": {
        "city": "New York",
        "state": "NY",
        "country": "US",
        "displayAddress": "Brooklyn, New York, US",
        "latitude": 40.7128,
        "longitude": -74.0060
      },
      "isPublic": true,
      "isFree": true,
      "hostName": "Startup NYC"
    }
  ],
  "cursor": null
}
```

- [ ] **Step 2: Write failing test**

Create `src/scrapers/partiful.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PartifulScraper } from './partiful';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/partiful.json'), 'utf-8')
);

const mockInput = {
  sources: ['partiful' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

describe('PartifulScraper.normalizeResponse', () => {
  it('normalizes fixture to EventItem[]', () => {
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.normalizeResponse(fixture);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('NYC Founders Happy Hour');
    expect(events[0].url).toBe('https://partiful.com/e/nyc-founders-happy-hour-jun26');
    expect(events[0].startAt).toMatch(/^2026-06-25/);
    expect(events[0].source).toBe('partiful');
    expect(events[0].venue?.city).toBe('New York');
    expect(events[0].venue?.lat).toBe(40.7128);
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(true);
    expect(events[0].organizer).toBe('Startup NYC');
  });

  it('handles virtual event', () => {
    const virtualFixture = {
      events: [{ ...fixture.events[0], isVirtual: true, location: null }],
    };
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.normalizeResponse(virtualFixture);
    expect(events[0].isOnline).toBe(true);
  });

  it('skips private events', () => {
    const privateFixture = {
      events: [{ ...fixture.events[0], isPublic: false }],
    };
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.normalizeResponse(privateFixture);
    expect(events).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npx vitest run src/scrapers/partiful.test.ts
```

Expected: FAIL — `Cannot find module './partiful'`

- [ ] **Step 4: Implement `src/scrapers/partiful.ts`**

```typescript
import { chromium } from 'playwright';
import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface PartifulLocation {
  city?: string;
  state?: string;
  country?: string;
  displayAddress?: string;
  latitude?: number;
  longitude?: number;
}

interface PartifulEvent {
  id: string;
  title: string;
  eventUrl: string;
  startTime: string;
  endTime?: string;
  description?: string;
  coverImage?: string;
  isVirtual?: boolean;
  location?: PartifulLocation | null;
  isPublic?: boolean;
  isFree?: boolean;
  hostName?: string;
}

interface PartifulResponse {
  events?: PartifulEvent[];
}

export class PartifulScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      let captured: PartifulResponse | null = null;

      // Intercept Partiful's explore API — verify this URL in browser DevTools
      await page.route('**/api/events/**', async (route) => {
        const response = await route.fetch();
        try {
          captured = (await response.json()) as PartifulResponse;
        } catch {
          captured = null;
        }
        await route.fulfill({ response });
      });

      const params = new URLSearchParams();
      if (this.input.query) params.set('q', this.input.query);

      await this.randomDelay();
      await page.goto(`https://partiful.com/explore?${params.toString()}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      const start = Date.now();
      while (!captured && Date.now() - start < 5000) {
        await page.waitForTimeout(200);
      }

      return captured ? this.normalizeResponse(captured) : [];
    } finally {
      await browser.close();
    }
  }

  normalizeResponse(data: PartifulResponse): EventItem[] {
    const now = new Date().toISOString();
    return (data.events ?? [])
      .filter((ev) => ev.isPublic !== false)
      .slice(0, this.maxResults)
      .map((ev) => {
        const loc = ev.location;
        const isOnline = ev.isVirtual ?? false;
        const venue: VenueInfo | undefined = loc
          ? {
              address: loc.displayAddress,
              city: loc.city,
              country: loc.country,
              lat: loc.latitude,
              lng: loc.longitude,
            }
          : undefined;

        const desc = stripHtml(ev.description ?? '');

        return {
          name: ev.title,
          url: ev.eventUrl,
          startAt: parseDate(ev.startTime),
          endDate: ev.endTime ? parseDate(ev.endTime) : undefined,
          description: desc,
          location: loc ? (loc.displayAddress ?? buildLocation(loc.city, loc.country)) : '',
          venue,
          isOnline,
          format: detectFormat(ev.title, desc),
          isFree: ev.isFree ?? true,
          ticketPrice: ev.isFree ? 'Free' : undefined,
          imageUrl: ev.coverImage,
          organizer: ev.hostName,
          source: 'partiful' as const,
          scrapedAt: now,
        };
      });
  }
}
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npx vitest run src/scrapers/partiful.test.ts
```

Expected: PASS — all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scrapers/partiful.ts src/scrapers/partiful.test.ts src/scrapers/__fixtures__/partiful.json
git commit -m "feat: add Partiful Playwright scraper with normalizer tests"
```

---

## Task 13: Main Orchestrator

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Write `src/main.ts`**

```typescript
import { Actor } from 'apify';
import type { InputSchema, EventItem, SourceId } from './types';
import { EventbriteScraper } from './scrapers/eventbrite';
import { MeetupScraper } from './scrapers/meetup';
import { LumaScraper } from './scrapers/luma';
import { PartifulScraper } from './scrapers/partiful';
import { HopinScraper } from './scrapers/hopin';
import { HumanitixScraper } from './scrapers/humanitix';
import { applyFilters } from './filters';
import { deduplicate } from './deduplicator';

const DEFAULT_SOURCES: SourceId[] = ['eventbrite', 'meetup', 'luma', 'partiful', 'hopin', 'humanitix'];

interface RunStats {
  source: SourceId;
  fetched: number;
  filtered: number;
  errors: number;
}

async function main() {
  await Actor.init();

  const rawInput = await Actor.getInput<Partial<InputSchema>>();
  const input: InputSchema = {
    sources: rawInput?.sources ?? DEFAULT_SOURCES,
    query: rawInput?.query,
    location: rawInput?.location,
    dateFrom: rawInput?.dateFrom,
    dateTo: rawInput?.dateTo,
    eventTypes: rawInput?.eventTypes,
    industries: rawInput?.industries,
    format: rawInput?.format ?? 'both',
    priceType: rawInput?.priceType ?? 'both',
    language: rawInput?.language,
    maxResults: rawInput?.maxResults ?? 200,
    maxResultsPerSource: rawInput?.maxResultsPerSource ?? 50,
  };

  const scraperMap: Record<SourceId, () => Promise<EventItem[]>> = {
    eventbrite: () => new EventbriteScraper({ input }).scrape(),
    meetup: () => new MeetupScraper({ input }).scrape(),
    luma: () => new LumaScraper({ input }).scrape(),
    partiful: () => new PartifulScraper({ input }).scrape(),
    hopin: () => new HopinScraper({ input }).scrape(),
    humanitix: () => new HumanitixScraper({ input }).scrape(),
  };

  const allEvents: EventItem[] = [];
  const stats: RunStats[] = [];

  const results = await Promise.allSettled(
    input.sources.map(async (source) => {
      const events = await scraperMap[source]();
      return { source, events };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { source, events } = result.value;
      const filtered = applyFilters(events, input);
      stats.push({ source, fetched: events.length, filtered: filtered.length, errors: 0 });
      allEvents.push(...filtered);
      console.log(`[${source}] fetched=${events.length} filtered=${filtered.length}`);
    } else {
      console.error(`[scraper] failed:`, result.reason);
    }
  }

  const deduped = deduplicate(allEvents).slice(0, input.maxResults);

  const dataset = await Actor.openDataset();
  await dataset.pushData(deduped);

  console.log(`Done. Total events after dedup: ${deduped.length}`);
  console.log('Per-source stats:', JSON.stringify(stats, null, 2));

  await Actor.exit();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the project compiles cleanly**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run all unit tests to confirm nothing broke**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: add main orchestrator wiring all scrapers"
```

---

## Task 14: Apify Store Metadata

**Files:**
- Create: `.actor/actor.json`
- Create: `.actor/input_schema.json`

- [ ] **Step 1: Create `.actor/actor.json`**

```json
{
  "actorSpecification": 1,
  "name": "event-scraper",
  "title": "Event Scraper — Eventbrite, Meetup, Lu.ma & More",
  "description": "Scrape events from 6 major platforms (Eventbrite, Meetup, Lu.ma, Partiful, Hopin, Humanitix) with 8 filter dimensions: keywords, location/radius, date range, event type, industry, format, price, and language.",
  "version": "1.0",
  "buildTag": "latest",
  "categories": ["SCRAPING", "MARKETING"],
  "defaultRunOptions": {
    "build": "latest",
    "timeoutSecs": 3600,
    "memoryMbytes": 4096
  },
  "storages": {
    "dataset": {
      "actorSpecification": 1,
      "title": "Event Scraper Results",
      "views": {
        "overview": {
          "title": "Events",
          "transformation": { "fields": ["name", "url", "startAt", "location", "format", "isFree", "source"] },
          "display": {
            "component": "table",
            "properties": {
              "name": { "label": "Event Name", "format": "text" },
              "url": { "label": "URL", "format": "link" },
              "startAt": { "label": "Start Date", "format": "datetime" },
              "location": { "label": "Location", "format": "text" },
              "format": { "label": "Type", "format": "text" },
              "isFree": { "label": "Free?", "format": "boolean" },
              "source": { "label": "Source", "format": "text" }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create `.actor/input_schema.json`**

```json
{
  "title": "Event Scraper Input",
  "type": "object",
  "schemaVersion": 1,
  "properties": {
    "sources": {
      "title": "Sources to scrape",
      "type": "array",
      "description": "Select which event platforms to scrape. Leave all checked to scrape all 6.",
      "editor": "select",
      "items": { "type": "string" },
      "prefill": ["eventbrite", "meetup", "luma", "partiful", "hopin", "humanitix"],
      "enum": ["eventbrite", "meetup", "luma", "partiful", "hopin", "humanitix"],
      "enumTitles": ["Eventbrite", "Meetup", "Lu.ma", "Partiful", "Hopin", "Humanitix"]
    },
    "query": {
      "title": "Keyword search",
      "type": "string",
      "description": "Search query passed to each source's search endpoint.",
      "editor": "textfield",
      "example": "AI startup"
    },
    "location": {
      "title": "Location filter",
      "type": "object",
      "description": "Filter by city/country or by lat/lng/radiusKm. Use one approach, not both.",
      "editor": "json",
      "example": { "city": "San Francisco", "country": "US" }
    },
    "dateFrom": {
      "title": "From date",
      "type": "string",
      "description": "Include only events starting on or after this date (YYYY-MM-DD).",
      "editor": "datepicker"
    },
    "dateTo": {
      "title": "To date",
      "type": "string",
      "description": "Include only events starting on or before this date (YYYY-MM-DD).",
      "editor": "datepicker"
    },
    "eventTypes": {
      "title": "Event types",
      "type": "array",
      "description": "Only include events of these types. Leave empty for all types.",
      "editor": "select",
      "items": { "type": "string" },
      "enum": ["conference", "meetup", "workshop", "hackathon", "webinar", "summit", "other"],
      "enumTitles": ["Conference", "Meetup", "Workshop", "Hackathon", "Webinar", "Summit", "Other"]
    },
    "industries": {
      "title": "Industries",
      "type": "array",
      "description": "Filter by industry keywords matched against event description and tags.",
      "editor": "stringList",
      "example": ["AI & Machine Learning", "Fintech"]
    },
    "format": {
      "title": "Event format",
      "type": "string",
      "description": "Filter by online, in-person, or return both.",
      "editor": "select",
      "enum": ["online", "in-person", "both"],
      "enumTitles": ["Online only", "In-person only", "Both"],
      "default": "both"
    },
    "priceType": {
      "title": "Price type",
      "type": "string",
      "description": "Filter by free, paid, or return both.",
      "editor": "select",
      "enum": ["free", "paid", "both"],
      "enumTitles": ["Free only", "Paid only", "Both"],
      "default": "both"
    },
    "language": {
      "title": "Language",
      "type": "string",
      "description": "ISO 639-1 language code (e.g. en, es, fr). Leave empty for all languages.",
      "editor": "textfield",
      "example": "en"
    },
    "maxResults": {
      "title": "Max total results",
      "type": "integer",
      "description": "Hard cap on total events returned across all sources.",
      "editor": "number",
      "default": 200,
      "minimum": 1,
      "maximum": 1000
    },
    "maxResultsPerSource": {
      "title": "Max results per source",
      "type": "integer",
      "description": "Cap per platform to prevent one source dominating results.",
      "editor": "number",
      "default": 50,
      "minimum": 1,
      "maximum": 200
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .actor/actor.json .actor/input_schema.json
git commit -m "feat: add Apify Store metadata and input schema UI"
```

---

## Task 15: Plugin/Theme Bug Fixes

**Files:**
- Modify: `/Users/avinashchaubey/Local Sites/founderstimes/app/public/wp-content/themes/founders-times/inc/card-radar-event.php`

> These are in the separate WordPress local install, not this actor repo. Commit separately in that repo.

- [ ] **Step 1: Read the file to find the exact field references**

```bash
grep -n "event_date\|event_location" \
  "/Users/avinashchaubey/Local Sites/founderstimes/app/public/wp-content/themes/founders-times/inc/card-radar-event.php"
```

Note the exact line numbers returned.

- [ ] **Step 2: Replace `event_date` with `radar_date`**

In `card-radar-event.php`, find all occurrences of `get_post_meta($post->ID, 'event_date', true)` (or equivalent) and change the meta key to `radar_date`.

- [ ] **Step 3: Replace `event_location` with `location`**

In the same file, find all occurrences of `get_post_meta($post->ID, 'event_location', true)` and change the meta key to `location`.

- [ ] **Step 4: Verify in browser**

Open a published event in the local WordPress site and confirm the event card now shows:
- The correct date in the calendar column (previously blank "🗓️ TBD")
- The correct city in the location row (previously blank "📍")

- [ ] **Step 5: Commit in the WordPress plugin repo**

```bash
cd "/Users/avinashchaubey/Local Sites/founderstimes/app/public/wp-content/themes/founders-times"
git add inc/card-radar-event.php
git commit -m "fix: use radar_date and location meta keys in event card template"
```

---

## Final Check

- [ ] Run all tests one last time from the actor repo root

```bash
cd /Users/avinashchaubey/Applications/apify-event-scrapper
npx vitest run
```

Expected: all tests pass.

- [ ] Build TypeScript to verify no type errors

```bash
npx tsc
```

Expected: `dist/` created, no errors.

- [ ] Final commit

```bash
git add -A
git commit -m "chore: verify clean build and all tests passing"
```
