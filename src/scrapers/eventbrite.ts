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

/** Scrapes Eventbrite SSR search pages by parsing JSON-LD blocks. */
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

  /** Build the Eventbrite search URL from the input parameters. */
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

  /** Parse all JSON-LD Event blocks from HTML and return normalized EventItems. */
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
