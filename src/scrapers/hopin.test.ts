import { describe, it, expect } from 'vitest';
import { HopinScraper } from './hopin';

const mockInput = {
  sources: ['hopin' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

describe('HopinScraper', () => {
  it('returns empty array — hopin.to is shut down', async () => {
    const scraper = new HopinScraper({ input: mockInput });
    const events = await scraper.scrape();
    expect(events).toHaveLength(0);
  });
});
