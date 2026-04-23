import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MeetupScraper } from './meetup';

const fixtureHtml = readFileSync(
  join(__dirname, '__fixtures__/meetup.html'),
  'utf-8'
);

const mockInput = {
  sources: ['meetup' as const],
  query: 'AI',
  maxResults: 200,
  maxResultsPerSource: 50,
};

describe('MeetupScraper', () => {
  it('parses HTML JSON-LD fixture into EventItem[]', () => {
    const scraper = new MeetupScraper({ input: mockInput });
    const events = scraper.parseEvents(fixtureHtml);

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('SF AI Builders Monthly Meetup');
    expect(events[0].url).toBe('https://www.meetup.com/sf-ai-builders/events/123456789/');
    expect(events[0].source).toBe('meetup');
    expect(events[0].venue?.city).toBe('San Francisco');
    expect(events[0].isOnline).toBe(false);
    expect(events[0].isFree).toBe(true);
    expect(events[0].organizer).toBe('SF AI Builders');
    expect(events[0].description).not.toContain('<p>');
  });

  it('skips entries without @type Event', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      [{"@type":"Organization","name":"test"}]
      </script></head><body></body></html>`;
    const scraper = new MeetupScraper({ input: mockInput });
    expect(scraper.parseEvents(html)).toHaveLength(0);
  });

  it('handles non-array JSON-LD block', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {
        "@type": "Event",
        "name": "Solo Meetup",
        "url": "https://www.meetup.com/group/events/999/",
        "startDate": "2026-07-01T10:00:00Z"
      }
      </script></head><body></body></html>`;
    const scraper = new MeetupScraper({ input: mockInput });
    const events = scraper.parseEvents(html);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('Solo Meetup');
  });
});
