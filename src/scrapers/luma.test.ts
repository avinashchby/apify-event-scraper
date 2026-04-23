import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { LumaScraper } from './luma';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__/luma.json'), 'utf-8')
);

const mockInput = {
  sources: ['luma' as const],
  maxResults: 200,
  maxResultsPerSource: 50,
};

describe('LumaScraper.normalizeResponse', () => {
  it('normalizes fixture to EventItem[]', () => {
    const scraper = new LumaScraper({ input: mockInput });
    const events = scraper.normalizeResponse(fixture);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Founders & Investors Dinner SF');
    expect(events[0].url).toBe('https://lu.ma/founders-dinner-sf-jun26');
    expect(events[0].startAt).toMatch(/^2026-06-18/);
    expect(events[0].source).toBe('luma');
    expect(events[0].venue?.city).toBe('San Francisco');
    expect(events[0].venue?.country).toBe('US');
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(false);
    expect(events[0].ticketPrice).toBe('$45.00');
    expect(events[0].speakers).toHaveLength(1);
    expect(events[0].speakers![0].name).toBe('Jane Doe');
  });

  it('handles online event', () => {
    const onlineFixture = {
      entries: [{
        event: {
          ...fixture.entries[0].event,
          location_type: 'online',
          geo_address_info: null,
        },
      }],
    };
    const scraper = new LumaScraper({ input: mockInput });
    const events = scraper.normalizeResponse(onlineFixture);
    expect(events[0].isOnline).toBe(true);
  });

  it('handles free event', () => {
    const freeFixture = {
      entries: [{
        event: {
          ...fixture.entries[0].event,
          ticket_info: { is_free: true },
        },
      }],
    };
    const scraper = new LumaScraper({ input: mockInput });
    const events = scraper.normalizeResponse(freeFixture);
    expect(events[0].isFree).toBe(true);
    expect(events[0].ticketPrice).toBe('Free');
  });
});
