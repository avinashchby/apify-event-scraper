import { chromium } from 'playwright';
import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface PartifulLocationInfo {
  city?: string;
  state?: string;
  country?: string;
  fullAddress?: string;
  isVirtual?: boolean;
}

interface PartifulEventRaw {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  timezone?: string;
  hostName?: string;
  image?: string;
  isPublic?: boolean;
  status?: string;
  locationInfo?: PartifulLocationInfo;
}

interface PartifulNextData {
  props?: {
    pageProps?: {
      trendingSections?: Record<string, PartifulEventRaw[]> | PartifulEventRaw[];
      events?: PartifulEventRaw[];
    };
  };
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

      await this.randomDelay();
      await page.goto('https://partiful.com/explore', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Partiful is a Next.js app — event data is SSR'd into __NEXT_DATA__
      const nextData = await page.evaluate((): unknown => {
        const el = document.getElementById('__NEXT_DATA__');
        if (!el || !el.textContent) return null;
        try {
          return JSON.parse(el.textContent);
        } catch {
          return null;
        }
      });

      if (!nextData) return [];
      return this.extractFromNextData(nextData as PartifulNextData);
    } finally {
      await browser.close();
    }
  }

  extractFromNextData(data: PartifulNextData): EventItem[] {
    const pageProps = data?.props?.pageProps;
    if (!pageProps) return [];

    const rawEvents: PartifulEventRaw[] = [];

    // trendingSections is a dict keyed by city name, each value is an array of events
    const sections = pageProps.trendingSections;
    if (sections && !Array.isArray(sections)) {
      for (const cityEvents of Object.values(sections)) {
        if (Array.isArray(cityEvents)) rawEvents.push(...cityEvents);
      }
    } else if (Array.isArray(sections)) {
      rawEvents.push(...sections);
    }

    // some pages expose a flat events array
    if (pageProps.events && Array.isArray(pageProps.events)) {
      rawEvents.push(...pageProps.events);
    }

    // deduplicate by id
    const seen = new Set<string>();
    const unique = rawEvents.filter((ev) => {
      if (!ev.id || seen.has(ev.id)) return false;
      seen.add(ev.id);
      return true;
    });

    const query = this.input.query?.toLowerCase();
    const now = new Date().toISOString();

    return unique
      .filter((ev) => ev.isPublic !== false && ev.status !== 'CANCELLED')
      .filter((ev) => {
        if (!query) return true;
        const text = `${ev.title} ${ev.description ?? ''}`.toLowerCase();
        return text.includes(query);
      })
      .slice(0, this.maxResults)
      .map((ev) => this.normalizeEvent(ev, now));
  }

  private normalizeEvent(ev: PartifulEventRaw, scrapedAt: string): EventItem {
    const loc = ev.locationInfo;
    const isOnline = loc?.isVirtual ?? false;
    const city = loc?.city;
    const country = loc?.country;
    const venue: VenueInfo | undefined =
      city || country || loc?.fullAddress
        ? { address: loc?.fullAddress, city, country }
        : undefined;

    const desc = stripHtml(ev.description ?? '');

    return {
      url: `https://partiful.com/e/${ev.id}`,
      name: ev.title,
      startAt: parseDate(ev.startDate),
      endDate: ev.endDate ? parseDate(ev.endDate) : undefined,
      description: desc,
      location: loc?.fullAddress ?? buildLocation(city, country),
      venue,
      isOnline,
      format: detectFormat(ev.title, desc),
      isFree: false, // Partiful doesn't expose pricing in SSR data
      ticketPrice: undefined,
      imageUrl: ev.image,
      organizer: ev.hostName,
      source: 'partiful' as const,
      scrapedAt,
    };
  }
}
