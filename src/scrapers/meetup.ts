import * as cheerio from 'cheerio';
import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface MeetupJsonLdEvent {
  '@type': string;
  name?: string;
  url?: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  eventAttendanceMode?: string;
  location?: {
    '@type'?: string;
    name?: string;
    address?: {
      addressLocality?: string;
      addressRegion?: string;
      addressCountry?: string;
      streetAddress?: string;
    };
  };
  organizer?: { name?: string; url?: string };
}

/** Scrapes events from Meetup's public search page JSON-LD. */
export class MeetupScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const params = new URLSearchParams({
      keywords: this.input.query ?? '',
      source: 'EVENTS',
    });
    const url = `https://www.meetup.com/find/?${params.toString()}`;

    const res = await this.withRetry(() =>
      this.fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
    );
    if (!res.ok) throw new Error(`Meetup HTTP ${res.status}`);
    return this.parseEvents(await res.text());
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
        for (const ev of entries as MeetupJsonLdEvent[]) {
          if (items.length >= this.maxResults) break;
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

  private normalizeEntry(ev: MeetupJsonLdEvent, scrapedAt: string): EventItem | null {
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
    const image = ev.image?.startsWith('http') ? ev.image : undefined;

    return {
      name: ev.name,
      url: ev.url,
      startAt: parseDate(ev.startDate),
      endDate: ev.endDate ? parseDate(ev.endDate) : undefined,
      description: desc,
      location: buildLocation(city, country),
      venue,
      isOnline,
      format: detectFormat(ev.name, desc),
      isFree: true, // Meetup search JSON-LD doesn't expose price — default to free
      ticketPrice: undefined,
      imageUrl: image,
      organizer: ev.organizer?.name,
      source: 'meetup',
      scrapedAt,
    };
  }
}
