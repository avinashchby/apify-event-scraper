import { describe, it, expect } from 'vitest';
import { deduplicate } from './deduplicator';
import type { EventItem } from './types';

const base: EventItem = {
  name: 'AI Summit 2026',
  url: 'https://eventbrite.com/e/ai-summit-123',
  startAt: '2026-06-15T09:00:00.000Z',
  description: 'A conference about AI.',
  location: 'San Francisco, US',
  isOnline: false,
  format: 'conference',
  isFree: false,
  source: 'eventbrite',
  scrapedAt: '2026-04-23T10:00:00.000Z',
};

describe('deduplicate', () => {
  it('keeps single event unchanged', () => {
    expect(deduplicate([base])).toHaveLength(1);
  });

  it('removes exact URL duplicate from different source', () => {
    const twin = { ...base, url: 'https://eventbrite.com/e/ai-summit-123', source: 'meetup' as const };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('removes duplicate with trailing slash in URL', () => {
    const twin = { ...base, url: 'https://eventbrite.com/e/ai-summit-123/', source: 'meetup' as const };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('removes duplicate with http vs https URL', () => {
    const twin = { ...base, url: 'http://eventbrite.com/e/ai-summit-123', source: 'hopin' as const };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('removes same title + date from different source', () => {
    const twin = {
      ...base,
      url: 'https://meetup.com/events/999',
      source: 'meetup' as const,
    };
    expect(deduplicate([base, twin])).toHaveLength(1);
  });

  it('keeps events with same name but different dates', () => {
    const nextYear = { ...base, url: 'https://eventbrite.com/e/ai-summit-456', startAt: '2027-06-15T09:00:00.000Z' };
    expect(deduplicate([base, nextYear])).toHaveLength(2);
  });

  it('keeps first occurrence when deduplicating', () => {
    const twin = { ...base, source: 'meetup' as const };
    const result = deduplicate([base, twin]);
    expect(result[0].source).toBe('eventbrite');
  });
});
