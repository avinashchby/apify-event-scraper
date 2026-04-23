import * as cheerio from 'cheerio';
import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface HumanitixJsonLdEvent {
  '@type': string;
  name?: string;
  url?: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  description?: string;
  eventAttendanceMode?: string;
  location?: {
    '@type'?: string;
    name?: string;
    address?: {
      addressLocality?: string;
      addressCountry?: string;
      streetAddress?: string;
    };
  };
  organizer?: { name?: string };
  offers?: { price?: string | number; priceCurrency?: string };
}

export class HumanitixScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const url = this.buildUrl();
    const res = await this.withRetry(() =>
      this.fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      })
    );
    if (!res.ok) throw new Error(`Humanitix HTTP ${res.status}`);
    return this.parseEvents(await res.text());
  }

  /** URL format: /au/search/{place}/{keyword} */
  private buildUrl(): string {
    const loc = this.input.location;
    const place =
      loc?.city && loc?.country
        ? `${loc.country.toLowerCase()}--${loc.city.toLowerCase().replace(/\s+/g, '-')}`
        : 'online';
    const keyword = encodeURIComponent(this.input.query ?? 'events');
    return `https://humanitix.com/au/search/${place}/${keyword}`;
  }

  parseEvents(html: string): EventItem[] {
    const $ = cheerio.load(html);
    const items: EventItem[] = [];
    const now = new Date().toISOString();

    $('script[type="application/ld+json"]').each((_, el) => {
      if (items.length >= this.maxResults) return false;
      try {
        const raw = JSON.parse($(el).html() ?? '{}') as Record<string, unknown>;
        if (raw['@type'] !== 'ItemList') return;
        for (const listItem of (raw.itemListElement as Array<{ item?: HumanitixJsonLdEvent }>) ?? []) {
          if (items.length >= this.maxResults) break;
          const ev = listItem.item;
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

  private normalizeEntry(ev: HumanitixJsonLdEvent, scrapedAt: string): EventItem | null {
    if (!ev.startDate || !ev.name || !ev.url) return null;
    const addr = ev.location?.address;
    const city = addr?.addressLocality;
    const country = addr?.addressCountry?.toUpperCase();
    const venue: VenueInfo = {
      name: ev.location?.name,
      address: addr?.streetAddress,
      city,
      country,
    };
    const isOnline =
      ev.eventAttendanceMode?.includes('OnlineEventAttendanceMode') ?? false;
    const desc = stripHtml(ev.description ?? '');
    const priceRaw = ev.offers?.price;
    const isFree = priceRaw === undefined || priceRaw === 0 || priceRaw === '0' || priceRaw === 'free';

    return {
      name: ev.name,
      url: ev.url,
      startAt: parseDate(ev.startDate),
      endDate: ev.endDate ? parseDate(ev.endDate) : undefined,
      description: desc,
      location: buildLocation(city, country) || ev.location?.name || '',
      venue,
      isOnline,
      format: detectFormat(ev.name, desc),
      isFree,
      ticketPrice: isFree ? 'Free' : `${priceRaw} ${ev.offers?.priceCurrency ?? ''}`.trim(),
      imageUrl: ev.image,
      organizer: ev.organizer?.name,
      source: 'humanitix',
      scrapedAt,
    };
  }
}
