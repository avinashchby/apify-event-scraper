import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HopinScraper } from './hopin';

const fixtureHtml = readFileSync(join(__dirname, '__fixtures__/hopin.html'), 'utf-8');

const mockInput = {
  sources: ['hopin' as const],
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

describe('HopinScraper', () => {
  it('parses fixture HTML into EventItem[]', async () => {
    const scraper = new HopinScraper({ input: mockInput, fetchFn: makeMockFetch(fixtureHtml) });
    const events = await scraper.scrape();

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('AI Product Summit 2026');
    expect(events[0].url).toContain('hopin');
    expect(events[0].startAt).toMatch(/^2026-07-10/);
    expect(events[0].source).toBe('hopin');
    expect(events[0].isFree).toBe(true);
    expect(events[0].description).toContain('AI product managers');
  });

  it('throws on HTTP error', async () => {
    const scraper = new HopinScraper({ input: mockInput, fetchFn: makeMockFetch('', 403) });
    await expect(scraper.scrape()).rejects.toThrow('Hopin HTTP 403');
  });
});
