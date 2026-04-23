import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
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

interface MeetupJsonLd {
  '@type': string;
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  eventAttendanceMode?: string;
  location?: {
    name?: string;
    address?: {
      addressLocality?: string;
      addressCountry?: string;
      streetAddress?: string;
    };
  };
  organizer?: { name?: string };
  image?: string | string[];
}

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

/** Scrapes Meetup events via Playwright. Renders the search page, parses JSON-LD; falls back to cheerio link extraction. */
export class MeetupScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    // Test mode: custom fetchFn injected — bypass Playwright for unit tests
    if (this.fetch !== globalThis.fetch) {
      return this.scrapeViaApi();
    }
    return this.scrapeViaPlaywright();
  }

  /** Direct GraphQL API path — used in unit tests via injected fetchFn. */
  private async scrapeViaApi(): Promise<EventItem[]> {
    const loc = this.input.location;
    const variables: Record<string, unknown> = {
      query: this.input.query ?? '',
      lat: loc?.lat,
      lon: loc?.lng,
      radius: loc?.radiusKm ? Math.round(loc.radiusKm * 0.621371) : undefined,
    };

    const res = await this.withRetry(() =>
      this.fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: SEARCH_QUERY, variables }),
      })
    );

    if (!res.ok) throw new Error(`Meetup HTTP ${res.status}`);

    const json = (await res.json()) as MeetupResponse;
    return this.normalizeEdges(json.data?.keywordSearch?.edges ?? []);
  }

  /** Playwright path — renders the search page and extracts events from the resulting HTML. */
  private async scrapeViaPlaywright(): Promise<EventItem[]> {
    const url = this.buildSearchUrl();

    // Meetup uses Cloudflare Bot Management — try up to 2 times with different wait strategies
    for (const [attempt, waitUntil, extraWait] of [
      [1, 'networkidle', 0],
      [2, 'load', 6000],
    ] as const) {
      const html = await this.fetchHtml(url, waitUntil as 'networkidle' | 'load', extraWait);
      console.log(`[meetup] attempt ${attempt}: html=${html.length} bytes`);

      // If HTML is too small it's a bot-challenge page — retry
      if (html.length < 500000) {
        console.log(`[meetup] attempt ${attempt}: page likely bot-blocked, ${attempt < 2 ? 'retrying' : 'giving up'}`);
        if (attempt < 2) continue;
        return [];
      }

      const jsonLdEvents = this.parseEvents(html);
      console.log(`[meetup] JSON-LD parsing found ${jsonLdEvents.length} events`);
      if (jsonLdEvents.length > 0) return jsonLdEvents;

      const linkEvents = this.parseEventLinks(html);
      if (linkEvents.length > 0) return linkEvents;
    }

    return [];
  }

  private async fetchHtml(url: string, waitUntil: 'networkidle' | 'load', extraWaitMs: number): Promise<string> {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      await this.randomDelay();
      // Warm up: visit homepage first so Cloudflare grants a session token
      await page.goto('https://www.meetup.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.goto(url, { waitUntil, timeout: 45000 });
      if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);
      console.log(`[meetup] page title: "${await page.title()}"`);
      return page.content();
    } finally {
      await browser.close();
    }
  }

  private buildSearchUrl(): string {
    // Try topic-based URL for queries that map to Meetup topics (less bot-guarded than /find/)
    const query = (this.input.query ?? '').toLowerCase().replace(/\s+/g, '-');
    const loc = this.input.location;
    if (query) {
      // /find/events/ with query string (more lenient than /find/ SPA)
      const params = new URLSearchParams({ keywords: this.input.query ?? '' });
      if (loc?.city) params.set('location', loc.country ? `${loc.city}, ${loc.country}` : loc.city);
      params.set('dateRange', 'upcoming');
      return `https://www.meetup.com/find/events/?${params.toString()}`;
    }
    const cityPath = loc?.city ? loc.city.toLowerCase().replace(/\s+/g, '-') : 'online';
    return `https://www.meetup.com/find/events/?location=${cityPath}&dateRange=upcoming`;
  }

  /** Parse Event JSON-LD blocks from rendered HTML (also used directly in unit tests). */
  parseEvents(html: string): EventItem[] {
    const $ = cheerio.load(html);
    const now = new Date().toISOString();
    const items: EventItem[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      if (items.length >= this.maxResults) return false;
      try {
        const raw: unknown = JSON.parse($(el).html() ?? '{}');
        const entries = Array.isArray(raw) ? raw : [raw];
        for (const ev of entries as MeetupJsonLd[]) {
          if (items.length >= this.maxResults) break;
          if (ev['@type'] !== 'Event' || !ev.name || !ev.url || !ev.startDate) continue;
          const item = this.normalizeJsonLdEntry(ev, now);
          if (item) items.push(item);
        }
      } catch {
        // malformed JSON-LD — skip
      }
    });

    return items;
  }

  /** Extract event links from rendered HTML using cheerio — fallback when no JSON-LD is present. */
  private parseEventLinks(html: string): EventItem[] {
    const $ = cheerio.load(html);
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const items: EventItem[] = [];


    // Meetup's rendered event cards contain links matching /group-slug/events/DIGITS/
    $('a[href*="/events/"]').each((_, el) => {
      if (items.length >= this.maxResults) return false;
      const rawHref = $(el).attr('href') ?? '';
      // Only capture deep event links (group + events + id), not nav/filter links
      if (!/\/[\w-]+\/events\/\d+\/?/.test(rawHref)) return;
      const eventUrl = rawHref.startsWith('http') ? rawHref : `https://www.meetup.com${rawHref}`;
      if (seen.has(eventUrl)) return;
      seen.add(eventUrl);

      // Title: prefer nearest heading, fall back to link text
      const card = $(el).closest('li, article, [class*="card"], [class*="Card"], [class*="event"]');
      const heading = card.find('h2, h3, [class*="title"], [class*="Title"]').first();
      const title = (heading.text().trim() || $(el).text().trim()).slice(0, 120);
      if (!title || title.length < 3) return;

      // Date: look for <time datetime="..."> in the card
      const timeEl = card.find('time[datetime]').first();
      const startAt = timeEl.attr('datetime') ? parseDate(timeEl.attr('datetime')!) : now;

      items.push({
        name: title,
        url: eventUrl,
        startAt,
        description: '',
        location: '',
        isOnline: false,
        format: detectFormat(title, ''),
        isFree: true,
        source: 'meetup',
        scrapedAt: now,
      });
    });

    console.log(`[meetup] link extraction found ${items.length} events`);
    return items;
  }

  private normalizeJsonLdEntry(ev: MeetupJsonLd, scrapedAt: string): EventItem | null {
    if (!ev.startDate) return null;
    const city = ev.location?.address?.addressLocality;
    const country = ev.location?.address?.addressCountry;
    const venue: VenueInfo = {
      name: ev.location?.name,
      address: ev.location?.address?.streetAddress,
      city,
      country,
    };
    const isOnline = ev.eventAttendanceMode?.includes('OnlineEventAttendanceMode') ?? false;
    const desc = stripHtml(ev.description ?? '');
    const image = Array.isArray(ev.image) ? ev.image[0] : ev.image;

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
      isFree: true,
      imageUrl: image,
      organizer: ev.organizer?.name,
      source: 'meetup',
      scrapedAt,
    };
  }

  normalizeEdges(edges: { node?: MeetupEvent }[]): EventItem[] {
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
