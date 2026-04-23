import type { EventFormat } from '../types';

/**
 * Parse various date formats into ISO string.
 * Handles: ISO strings, millisecond timestamps (Meetup), date-only strings.
 * Falls back to current date for invalid input.
 */
export function parseDate(raw: string | number): string {
  if (typeof raw === 'number') {
    const ms = raw > 1e10 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  const d = new Date(raw);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

/**
 * Remove HTML tags and entities, collapse whitespace.
 * Used to clean descriptions from Meetup and other sources.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect event format from title and description.
 * Priority: hackathon > webinar > workshop > summit > conference > meetup > other
 */
export function detectFormat(title: string, description: string): EventFormat {
  const text = `${title} ${description}`.toLowerCase();
  if (/\bhackathon\b/.test(text)) return 'hackathon';
  if (/\bwebinar\b/.test(text)) return 'webinar';
  if (/\bworkshop\b/.test(text)) return 'workshop';
  if (/\bsummit\b/.test(text)) return 'summit';
  if (/\bconference\b|\bconf\b|\bsymposium\b/.test(text)) return 'conference';
  if (/\bmeetup\b|\bmeet[- ]up\b/.test(text)) return 'meetup';
  return 'other';
}

/**
 * Build location string from city and country.
 * Returns "City, Country" or just city if country missing.
 */
export function buildLocation(city?: string, country?: string): string {
  return [city, country].filter(Boolean).join(', ');
}
