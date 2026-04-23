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

    const res = await this.withRetry(() =>
      this.fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
      })
    );
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
          isOnline: false, // Hopin event cards don't expose online/in-person — default to in-person
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
