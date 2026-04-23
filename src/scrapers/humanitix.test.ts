import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HumanitixScraper } from './humanitix';

const fixtureHtml = readFileSync(join(__dirname, '__fixtures__/humanitix.html'), 'utf-8');

const mockInput = {
  sources: ['humanitix' as const],
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

describe('HumanitixScraper', () => {
  it('parses fixture HTML into EventItem[]', async () => {
    const scraper = new HumanitixScraper({ input: mockInput, fetchFn: makeMockFetch(fixtureHtml) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Startup Summit Sydney 2026');
    expect(events[0].url).toContain('humanitix.com');
    expect(events[0].startAt).toMatch(/2026-08-(04|05)/);
    expect(events[0].source).toBe('humanitix');
    expect(events[0].isFree).toBe(false);
    expect(events[0].organizer).toBe('TechSydney');
  });

  it('throws on HTTP error', async () => {
    const scraper = new HumanitixScraper({ input: mockInput, fetchFn: makeMockFetch('', 429) });
    await expect(scraper.scrape()).rejects.toThrow('Humanitix HTTP 429');
  });
});
