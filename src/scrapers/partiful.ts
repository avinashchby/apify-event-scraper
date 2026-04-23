import { chromium } from 'playwright';
import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface PartifulEvent {
  id: string;
  name: string;
  startAt: string;
  endAt?: string;
  description?: string;
  city?: string;
  country?: string;
  displayAddress?: string;
  isVirtual?: boolean;
  isFree?: boolean;
  ticketUrl?: string;
  imageUrl?: string;
  organizer?: string;
  tags?: string[];
  isPublic?: boolean;
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

      // Partiful has no public REST API — intercept the internal explore endpoint
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
        const isOnline = ev.isVirtual ?? false;
        const venue: VenueInfo | undefined =
          ev.city || ev.country
            ? {
                city: ev.city,
                country: ev.country,
              }
            : undefined;

        const desc = stripHtml(ev.description ?? '');

        return {
          url: `https://partiful.com/e/${ev.id}`,
          name: ev.name,
          startAt: parseDate(ev.startAt),
          endDate: ev.endAt ? parseDate(ev.endAt) : undefined,
          description: desc,
          location: ev.displayAddress ?? buildLocation(ev.city, ev.country),
          venue,
          isOnline,
          format: detectFormat(ev.name, desc),
          isFree: ev.isFree ?? false,
          ticketPrice: ev.isFree ? 'Free' : undefined,
          ticketUrl: ev.ticketUrl,
          imageUrl: ev.imageUrl,
          organizer: ev.organizer,
          tags: ev.tags,
          source: 'partiful' as const,
          scrapedAt: now,
        };
      });
  }
}
