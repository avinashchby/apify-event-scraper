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

    const res = await this.withRetry(() =>
      this.fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'text/html',
        },
      })
    );
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
          isOnline: false, // Humanitix card HTML doesn't expose online/in-person flag — default to in-person
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
