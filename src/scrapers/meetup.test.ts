import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MeetupScraper } from './meetup';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/meetup.json'), 'utf-8')
);

const mockInput = {
  sources: ['meetup' as const],
  query: 'AI',
  maxResults: 200,
  maxResultsPerSource: 50,
};

function makeMockFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('MeetupScraper', () => {
  it('parses fixture into EventItem[]', async () => {
    const scraper = new MeetupScraper({ input: mockInput, fetchFn: makeMockFetch(fixture) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('SF AI Builders Monthly Meetup');
    expect(events[0].url).toBe('https://www.meetup.com/sf-ai-builders/events/123456789/');
    expect(events[0].source).toBe('meetup');
    expect(events[0].venue?.city).toBe('San Francisco');
    expect(events[0].venue?.lat).toBe(37.7749);
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(true);
    expect(events[0].organizer).toBe('SF AI Builders');
    expect(events[0].description).not.toContain('<p>');
  });

  it('handles paid event with fee settings', async () => {
    const paid = {
      ...fixture,
      data: {
        keywordSearch: {
          edges: [{
            node: {
              ...fixture.data.keywordSearch.edges[0].node,
              feeSettings: { amount: 25, currency: 'USD' },
            },
          }],
          pageInfo: { hasNextPage: false },
        },
      },
    };
    const scraper = new MeetupScraper({ input: mockInput, fetchFn: makeMockFetch(paid) });
    const events = await scraper.scrape();
    expect(events[0].isFree).toBe(false);
    expect(events[0].ticketPrice).toContain('25');
  });

  it('throws on HTTP error', async () => {
    const scraper = new MeetupScraper({ input: mockInput, fetchFn: makeMockFetch({}, 500) });
    await expect(scraper.scrape()).rejects.toThrow('Meetup HTTP 500');
  });
});
