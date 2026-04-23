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

/** Scrapes Meetup events. Intercepts the site's own GraphQL calls via Playwright; falls back to JSON-LD parsing. */
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

  /** Playwright path — navigates the search page and captures the site's own GraphQL calls. */
  private async scrapeViaPlaywright(): Promise<EventItem[]> {
    const url = this.buildSearchUrl();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      let capturedEdges: { node?: MeetupEvent }[] | null = null;

      // Intercept the GraphQL call Meetup's React app makes during page load
      page.on('response', async (response) => {
        if (!response.url().includes('api.meetup.com')) return;
        try {
          const json = (await response.json()) as MeetupResponse;
          const edges = json?.data?.keywordSearch?.edges;
          if (Array.isArray(edges) && edges.length > 0 && !capturedEdges) {
            console.log(`[meetup] captured GraphQL response, ${edges.length} events`);
            capturedEdges = edges;
          }
        } catch {
          // ignore non-JSON or wrong shape
        }
      });

      await this.randomDelay();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      console.log(`[meetup] page title: "${await page.title()}"`);

      if (capturedEdges !== null) {
        return this.normalizeEdges(capturedEdges);
      }

      // Fallback: parse JSON-LD from the fully-rendered HTML
      console.log('[meetup] no GraphQL response captured, falling back to JSON-LD HTML parsing');
      const html = await page.content();
      const events = this.parseEvents(html);
      console.log(`[meetup] JSON-LD parsing found ${events.length} events`);
      return events;
    } finally {
      await browser.close();
    }
  }

  private buildSearchUrl(): string {
    const params = new URLSearchParams();
    if (this.input.query) params.set('keywords', this.input.query);
    const loc = this.input.location;
    if (loc?.city) {
      params.set('location', loc.country ? `${loc.city}, ${loc.country}` : loc.city);
    }
    params.set('dateRange', 'upcoming');
    params.set('source', 'EVENTS');
    return `https://www.meetup.com/find/?${params.toString()}`;
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
