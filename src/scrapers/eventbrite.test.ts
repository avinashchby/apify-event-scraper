import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EventbriteScraper } from './eventbrite';

const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__/eventbrite.html'),
  'utf-8'
);

const mockInput = {
  sources: ['eventbrite' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

function makeMockFetch(body: string, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

describe('EventbriteScraper', () => {
  it('parses fixture HTML into EventItem[]', async () => {
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch(fixtureHtml) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('AI Summit San Francisco 2026');
    expect(events[0].url).toBe('https://www.eventbrite.com/e/ai-summit-sf-2026-tickets-123456789');
    expect(events[0].startAt).toMatch(/^2026-06-15/);
    expect(events[0].source).toBe('eventbrite');
    expect(events[0].venue?.city).toBe('San Francisco');
    expect(events[0].venue?.country).toBe('US');
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(false);
    expect(events[0].ticketPrice).toContain('299');
    expect(events[0].organizer).toBe('AI Events LLC');
    expect(events[0].imageUrl).toBe('https://img.evbuc.com/ai-summit.jpg');
  });

  it('skips entries without @type Event', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
      [{"@type":"Organization","name":"test"}]
      </script></head><body></body></html>`;
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch(html) });
    expect(await scraper.scrape()).toHaveLength(0);
  });

  it('throws on non-200 response', async () => {
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch('', 403) });
    await expect(scraper.scrape()).rejects.toThrow('Eventbrite HTTP 403');
  });

  it('parses inline (non-array) JSON-LD', async () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Event",
        "name": "Solo Event",
        "url": "https://eventbrite.com/e/solo-1",
        "startDate": "2026-07-01T10:00:00Z",
        "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode"
      }
      </script></head><body></body></html>`;
    const scraper = new EventbriteScraper({ input: mockInput, fetchFn: makeMockFetch(html) });
    const events = await scraper.scrape();
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Solo Event');
  });
});
