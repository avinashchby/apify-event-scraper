import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PartifulScraper } from './partiful';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/partiful.json'), 'utf-8')
);

const mockInput = {
  sources: ['partiful' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

describe('PartifulScraper.normalizeResponse', () => {
  it('normalizes fixture to EventItem[]', () => {
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.normalizeResponse(fixture);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('NYC Founders Happy Hour');
    expect(events[0].isFree).toBe(true);
    expect(events[0].isOnline).toBe(false);
    expect(events[0].ticketUrl).toBe('https://partiful.com/e/evt-001/rsvp');
    expect(events[0].tags).toContain('networking');
    expect(events[0].tags).toContain('startups');
    expect(events[0].source).toBe('partiful');
    expect(events[0].scrapedAt).toBeTruthy();
    expect(events[0].url).toBe('https://partiful.com/e/evt-001');
    expect(events[0].endDate).toBe('2026-06-20T21:00:00.000Z');
  });

  it('virtual event → isOnline true', () => {
    const virtualFixture = {
      events: [
        {
          id: 'virtual-001',
          isVirtual: true,
          isPublic: true,
          name: 'Virtual',
          startAt: '2026-07-01T10:00:00Z',
          isFree: true,
        },
      ],
    };
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.normalizeResponse(virtualFixture);
    expect(events[0].isOnline).toBe(true);
  });

  it('private event filtered out', () => {
    const privateFixture = {
      events: [
        {
          id: 'private-001',
          isPublic: false,
          name: 'Private',
          startAt: '2026-07-01T10:00:00Z',
        },
      ],
    };
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.normalizeResponse(privateFixture);
    expect(events).toHaveLength(0);
  });
});
