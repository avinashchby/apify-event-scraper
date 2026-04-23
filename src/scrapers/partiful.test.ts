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

describe('PartifulScraper.extractFromNextData', () => {
  it('normalizes __NEXT_DATA__ fixture to EventItem[]', () => {
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.extractFromNextData(fixture);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('NYC Founders Happy Hour');
    expect(events[0].isOnline).toBe(false);
    expect(events[0].organizer).toBe('Founders Network');
    expect(events[0].source).toBe('partiful');
    expect(events[0].scrapedAt).toBeTruthy();
    expect(events[0].url).toBe('https://partiful.com/e/evt-001');
    expect(events[0].endDate).toBe('2026-06-20T21:00:00.000Z');
  });

  it('virtual event → isOnline true', () => {
    const virtualFixture = {
      props: {
        pageProps: {
          trendingSections: {
            Online: [
              {
                id: 'virtual-001',
                title: 'Virtual Webinar',
                startDate: '2026-07-01T10:00:00Z',
                isPublic: true,
                locationInfo: { isVirtual: true },
              },
            ],
          },
        },
      },
    };
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.extractFromNextData(virtualFixture);
    expect(events[0].isOnline).toBe(true);
  });

  it('private event filtered out', () => {
    const privateFixture = {
      props: {
        pageProps: {
          trendingSections: {
            NYC: [
              {
                id: 'private-001',
                title: 'Private Party',
                startDate: '2026-07-01T10:00:00Z',
                isPublic: false,
              },
            ],
          },
        },
      },
    };
    const scraper = new PartifulScraper({ input: mockInput });
    const events = scraper.extractFromNextData(privateFixture);
    expect(events).toHaveLength(0);
  });
});
