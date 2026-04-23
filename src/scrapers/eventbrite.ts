import { chromium } from 'playwright';
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

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Scrapes Eventbrite search pages by parsing JSON-LD blocks. */
export class EventbriteScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const url = this.buildUrl();

    // Eventbrite blocks raw fetch — use Playwright to load the search page
    const browser = await chromium.launch({ headless: true });
    let searchHtml: string;
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();
      await this.randomDelay();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
      searchHtml = await page.content();
      console.log(`[eventbrite] search page title: "${await page.title()}", html size: ${searchHtml.length}`);
    } finally {
      await browser.close();
    }

    // Parse full event data directly from the ItemList on the search page
    const events = this.parseSearchPage(searchHtml);
    console.log(`[eventbrite] parsed ${events.length} events from search page`);
    return events;
  }

  /** Build the Eventbrite search URL — keyword goes in the URL path, not query string. */
  private buildUrl(): string {
    const loc = this.input.location;
    const place =
      loc?.city && loc?.country
        ? `${loc.country.toLowerCase()}--${loc.city.toLowerCase().replace(/\s+/g, '-')}`
        : 'online';
    const keyword = this.input.query
      ? this.input.query.toLowerCase().replace(/\s+/g, '-')
      : 'events';
    const params = new URLSearchParams();
    if (this.input.dateFrom) params.set('start_date', this.input.dateFrom);
    if (this.input.dateTo) params.set('end_date', this.input.dateTo);
    const qs = params.toString();
    return `https://www.eventbrite.com/d/${place}/${keyword}/${qs ? '?' + qs : ''}`;
  }

  /** Parse full event data from ItemList JSON-LD on the search results page.
   *  Each itemListElement now embeds a full Event object under `.item`. */
  private parseSearchPage(html: string): EventItem[] {
    const $ = cheerio.load(html);
    const now = new Date().toISOString();
    const items: EventItem[] = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      if (items.length >= this.maxResults) return false;
      try {
        const raw = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
        if (raw['@type'] !== 'ItemList') return;
        for (const listItem of (raw.itemListElement as Array<{ item?: EventbriteJsonLd; url?: string }>) ?? []) {
          if (items.length >= this.maxResults) break;
          const ev = listItem.item ?? (listItem as unknown as EventbriteJsonLd);
          if (!ev || ev['@type'] !== 'Event' || !ev.name || !ev.url || !ev.startDate) continue;
          const item = this.normalizeEntry(ev, now);
          if (item) items.push(item);
        }
      } catch {
        // malformed JSON-LD — skip
      }
    });

    return items;
  }

  /** Extract event page URLs from the ItemList JSON-LD on the search results page. */
  private extractEventUrls(html: string): string[] {
    const $ = cheerio.load(html);
    const urls: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
        if (raw['@type'] === 'ItemList') {
          for (const listItem of (raw.itemListElement as Array<{ item?: { url?: string }; url?: string }>) ?? []) {
            const url = listItem.item?.url ?? listItem.url;
            if (url) urls.push(url);
          }
        }
      } catch {
        // malformed JSON-LD — skip
      }
    });
    return urls;
  }

  /** Fetch a single event page and parse its Event JSON-LD. */
  private async fetchEventPage(url: string): Promise<EventItem | null> {
    try {
      const res = await this.fetch(url, { headers: HEADERS });
      if (!res.ok) return null;
      return this.parseEventPage(await res.text());
    } catch {
      return null;
    }
  }

  /** Parse Event JSON-LD from an individual event page. */
  parseEventPage(html: string): EventItem | null {
    const $ = cheerio.load(html);
    const now = new Date().toISOString();
    let result: EventItem | null = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (result) return false;
      try {
        const raw: unknown = JSON.parse($(el).html() ?? '{}');
        const entries = Array.isArray(raw) ? raw : [raw];
        for (const ev of entries as EventbriteJsonLd[]) {
          if (ev['@type'] !== 'Event' || !ev.name || !ev.url || !ev.startDate) continue;
          result = this.normalizeEntry(ev, now);
          if (result) return false;
        }
      } catch {
        // malformed JSON-LD — skip
      }
    });
    return result;
  }

  /** @deprecated kept for unit tests that pass raw HTML directly */
  parseEvents(html: string): EventItem[] {
    const urls = this.extractEventUrls(html);
    void urls; // search page parsing is now async — this sync path is test-only
    return [];
  }

  /** Map a raw JSON-LD event entry to the canonical EventItem shape. */
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
