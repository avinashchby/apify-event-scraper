import { describe, it, expect } from 'vitest';
import { parseDate, stripHtml, detectFormat, buildLocation } from './normalize';

describe('parseDate', () => {
  it('parses ISO string', () => {
    expect(parseDate('2026-06-15T09:00:00Z')).toBe('2026-06-15T09:00:00.000Z');
  });

  it('parses Meetup millisecond timestamp', () => {
    const ms = new Date('2026-06-20T18:30:00Z').getTime(); // > 1e10
    const result = parseDate(ms);
    expect(result).toBe('2026-06-20T18:30:00.000Z');
  });

  it('parses date-only string', () => {
    const result = parseDate('2026-06-15');
    expect(result).toMatch(/^2026-06-15/);
  });

  it('returns fallback ISO string for invalid input', () => {
    const result = parseDate('not-a-date');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('stripHtml', () => {
  it('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('collapses multiple spaces', () => {
    expect(stripHtml('<p>  a  </p>')).toBe('a');
  });

  it('handles HTML entities', () => {
    expect(stripHtml('Hello &amp; world')).toBe('Hello world');
  });
});

describe('detectFormat', () => {
  it('detects hackathon', () => {
    expect(detectFormat('Global AI Hackathon', '')).toBe('hackathon');
  });

  it('detects conference', () => {
    expect(detectFormat('TechCrunch Disrupt Conference', '')).toBe('conference');
  });

  it('detects webinar', () => {
    expect(detectFormat('Marketing Webinar Series', '')).toBe('webinar');
  });

  it('detects meetup from description', () => {
    expect(detectFormat('Monthly Gathering', 'This is our monthly meet-up for builders')).toBe('meetup');
  });

  it('defaults to other', () => {
    expect(detectFormat('Random Event', 'No keywords here')).toBe('other');
  });
});

describe('buildLocation', () => {
  it('builds city, country string', () => {
    expect(buildLocation('San Francisco', 'US')).toBe('San Francisco, US');
  });

  it('handles missing country', () => {
    expect(buildLocation('London', undefined)).toBe('London');
  });

  it('handles both missing', () => {
    expect(buildLocation(undefined, undefined)).toBe('');
  });
});
