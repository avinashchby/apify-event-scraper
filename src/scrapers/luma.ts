import { chromium } from 'playwright';
import type { EventItem, VenueInfo, SpeakerInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

interface LumaGeoAddress {
  city?: string;
  country?: string;
  full_address?: string;
  latitude?: number;
  longitude?: number;
}

interface LumaHost {
  name: string;
  title?: string;
  affiliation?: string;
}

interface LumaEvent {
  api_id: string;
  name: string;
  url: string;
  start_at: string;
  end_at?: string;
  description?: string;
  cover_url?: string;
  location_type?: string;
  geo_address_info?: LumaGeoAddress | null;
  ticket_info?: { is_free?: boolean; price?: number; currency?: string } | null;
  hosts?: LumaHost[];
}

interface LumaResponse {
  entries?: { event: LumaEvent }[];
}

export class LumaScraper extends BaseScraper {
  private browser?: import('playwright').Browser;

  constructor(options: ScraperOptions, browser?: import('playwright').Browser) {
    super(options);
    this.browser = browser;
  }

  async scrape(): Promise<EventItem[]> {
    const launchedInternally = !this.browser;
    const browser = this.browser ?? await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      });
      const page = await context.newPage();

      const params = new URLSearchParams();
      if (this.input.query) params.set('query', this.input.query);
      if (this.input.location?.city) params.set('location', this.input.location.city);

      let data: LumaResponse | null = null;

      // Intercept any lu.ma API response that looks like a discover/search result
      await page.route('**', async (route) => {
        const req = route.request();
        const url = req.url();
        if (url.includes('lu.ma') && url.includes('/api/') && req.method() === 'GET') {
          const response = await route.fetch();
          try {
            const json = await response.json() as LumaResponse;
            if (json && Array.isArray(json.entries) && json.entries.length > 0 && data === null) {
              data = json;
            }
          } catch {
            // not JSON or not the endpoint we want
          }
          await route.fulfill({ response });
        } else {
          await route.continue();
        }
      });

      await this.randomDelay();
      await page.goto(`https://lu.ma/discover?${params.toString()}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Give the page time to fire API calls after initial render
      await page.waitForTimeout(5000);

      // Fallback: try __NEXT_DATA__ if no API response was captured
      if (!data) {
        const nextData = await page.evaluate((): unknown => {
          const el = document.getElementById('__NEXT_DATA__');
          if (!el?.textContent) return null;
          try { return JSON.parse(el.textContent); } catch { return null; }
        });
        data = this.extractFromNextData(nextData);
      }

      return data ? this.normalizeResponse(data) : [];
    } finally {
      if (launchedInternally) {
        await browser.close();
      }
    }
  }

  private extractFromNextData(raw: unknown): LumaResponse | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    // Walk props.pageProps for any entries array
    const pageProps = (obj['props'] as Record<string, unknown>)?.['pageProps'] as Record<string, unknown> | undefined;
    if (!pageProps) return null;
    if (Array.isArray(pageProps['entries'])) {
      return { entries: pageProps['entries'] as { event: LumaEvent }[] };
    }
    // Some lu.ma pages embed initialData
    const initialData = pageProps['initialData'] as Record<string, unknown> | undefined;
    if (initialData && Array.isArray(initialData['entries'])) {
      return { entries: initialData['entries'] as { event: LumaEvent }[] };
    }
    return null;
  }

  normalizeResponse(data: LumaResponse): EventItem[] {
    const now = new Date().toISOString();
    return (data.entries ?? [])
      .slice(0, this.maxResults)
      .map(({ event: ev }) => {
        const geo = ev.geo_address_info;
        const isOnline = ev.location_type === 'online';
        const venue: VenueInfo | undefined = geo
          ? {
              address: geo.full_address,
              city: geo.city,
              country: geo.country,
              lat: geo.latitude,
              lng: geo.longitude,
            }
          : undefined;

        const isFree = ev.ticket_info?.is_free ?? true;
        const priceRaw = ev.ticket_info?.price;
        const currency = ev.ticket_info?.currency ?? 'USD';
        const priceFormatted = priceRaw != null
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(priceRaw / 100)
          : undefined;

        const speakers: SpeakerInfo[] = (ev.hosts ?? []).map((h) => ({
          name: h.name,
          title: h.title,
          company: h.affiliation,
        }));

        const desc = stripHtml(ev.description ?? '');

        return {
          name: ev.name,
          url: ev.url,
          startAt: parseDate(ev.start_at),
          endDate: ev.end_at ? parseDate(ev.end_at) : undefined,
          description: desc,
          location: buildLocation(geo?.city, geo?.country),
          venue,
          isOnline,
          format: detectFormat(ev.name, desc),
          isFree,
          ticketPrice: isFree ? 'Free' : priceFormatted,
          imageUrl: ev.cover_url,
          speakers: speakers.length ? speakers : undefined,
          source: 'luma' as const,
          scrapedAt: now,
        };
      });
  }
}
