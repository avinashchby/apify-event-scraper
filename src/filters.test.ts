import { describe, it, expect } from 'vitest';
import {
  filterByKeyword,
  filterByLocation,
  filterByDate,
  filterByEventType,
  filterByIndustry,
  filterByFormat,
  filterByPrice,
  filterByLanguage,
  applyFilters,
} from './filters';
import type { EventItem, InputSchema } from './types';

const baseEvent: EventItem = {
  name: 'AI Summit 2026',
  url: 'https://example.com/event/1',
  startAt: '2026-06-15T09:00:00.000Z',
  description: 'A conference about artificial intelligence and machine learning.',
  location: 'San Francisco, US',
  venue: { city: 'San Francisco', country: 'US', lat: 37.7749, lng: -122.4194 },
  isOnline: false,
  format: 'conference',
  isFree: false,
  ticketPrice: 'From $299',
  tags: ['AI', 'machine learning'],
  language: 'en',
  source: 'eventbrite',
  scrapedAt: '2026-04-23T10:00:00.000Z',
};

describe('filterByKeyword', () => {
  it('matches keyword in name', () => {
    expect(filterByKeyword('AI Summit')(baseEvent)).toBe(true);
  });

  it('matches keyword in description', () => {
    expect(filterByKeyword('machine learning')(baseEvent)).toBe(true);
  });

  it('matches keyword in tags', () => {
    expect(filterByKeyword('machine learning')(baseEvent)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(filterByKeyword('ai summit')(baseEvent)).toBe(true);
  });

  it('rejects non-matching keyword', () => {
    expect(filterByKeyword('blockchain')(baseEvent)).toBe(false);
  });
});

describe('filterByLocation (city/country)', () => {
  it('matches city substring', () => {
    expect(filterByLocation({ city: 'San Francisco' })(baseEvent)).toBe(true);
  });

  it('is case-insensitive for city', () => {
    expect(filterByLocation({ city: 'san francisco' })(baseEvent)).toBe(true);
  });

  it('rejects different city', () => {
    expect(filterByLocation({ city: 'London' })(baseEvent)).toBe(false);
  });

  it('matches country', () => {
    expect(filterByLocation({ country: 'US' })(baseEvent)).toBe(true);
  });
});

describe('filterByLocation (radius)', () => {
  it('passes event within radius', () => {
    // Same coords → 0 km distance
    const fn = filterByLocation({ lat: 37.7749, lng: -122.4194, radiusKm: 10 });
    expect(fn(baseEvent)).toBe(true);
  });

  it('rejects event outside radius', () => {
    // London coords → far from SF
    const fn = filterByLocation({ lat: 51.5074, lng: -0.1278, radiusKm: 50 });
    expect(fn(baseEvent)).toBe(false);
  });

  it('rejects event with no venue coordinates', () => {
    const noCoords = { ...baseEvent, venue: { city: 'SF' } };
    const fn = filterByLocation({ lat: 37.7749, lng: -122.4194, radiusKm: 50 });
    expect(fn(noCoords)).toBe(false);
  });
});

describe('filterByDate', () => {
  it('passes event in range', () => {
    expect(filterByDate('2026-06-01', '2026-06-30')(baseEvent)).toBe(true);
  });

  it('rejects event before range', () => {
    expect(filterByDate('2026-07-01', '2026-07-31')(baseEvent)).toBe(false);
  });

  it('rejects event after range', () => {
    expect(filterByDate('2026-01-01', '2026-05-31')(baseEvent)).toBe(false);
  });

  it('passes with no dateFrom', () => {
    expect(filterByDate(undefined, '2026-12-31')(baseEvent)).toBe(true);
  });
});

describe('filterByEventType', () => {
  it('passes matching format', () => {
    expect(filterByEventType(['conference', 'meetup'])(baseEvent)).toBe(true);
  });

  it('rejects non-matching format', () => {
    expect(filterByEventType(['hackathon', 'webinar'])(baseEvent)).toBe(false);
  });
});

describe('filterByIndustry', () => {
  it('matches industry in description', () => {
    expect(filterByIndustry(['artificial intelligence'])(baseEvent)).toBe(true);
  });

  it('matches industry in tags', () => {
    expect(filterByIndustry(['AI'])(baseEvent)).toBe(true);
  });

  it('rejects unmatched industry', () => {
    expect(filterByIndustry(['Fintech', 'Healthtech'])(baseEvent)).toBe(false);
  });
});

describe('filterByFormat', () => {
  it('passes in-person event for in-person filter', () => {
    expect(filterByFormat('in-person')(baseEvent)).toBe(true);
  });

  it('rejects in-person event for online filter', () => {
    expect(filterByFormat('online')(baseEvent)).toBe(false);
  });

  it('passes online event for online filter', () => {
    const online = { ...baseEvent, isOnline: true };
    expect(filterByFormat('online')(online)).toBe(true);
  });
});

describe('filterByPrice', () => {
  it('rejects paid event for free filter', () => {
    expect(filterByPrice('free')(baseEvent)).toBe(false);
  });

  it('passes free event for free filter', () => {
    const free = { ...baseEvent, isFree: true };
    expect(filterByPrice('free')(free)).toBe(true);
  });

  it('passes paid event for paid filter', () => {
    expect(filterByPrice('paid')(baseEvent)).toBe(true);
  });
});

describe('filterByLanguage', () => {
  it('passes matching language', () => {
    expect(filterByLanguage('en')(baseEvent)).toBe(true);
  });

  it('rejects non-matching language', () => {
    expect(filterByLanguage('es')(baseEvent)).toBe(false);
  });

  it('passes event with no language field', () => {
    const noLang = { ...baseEvent, language: undefined };
    expect(filterByLanguage('en')(noLang)).toBe(true);
  });
});

describe('applyFilters', () => {
  const input: InputSchema = {
    sources: ['eventbrite'],
    query: 'AI',
    format: 'in-person',
    priceType: 'both',
    maxResults: 200,
    maxResultsPerSource: 50,
  };

  it('applies multiple filters and returns matching events', () => {
    const result = applyFilters([baseEvent], input);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no events match', () => {
    const result = applyFilters(
      [{ ...baseEvent, name: 'Crypto Summit', description: 'A cryptocurrency conference', tags: ['crypto'] }],
      input,
    );
    expect(result).toHaveLength(0);
  });
});
