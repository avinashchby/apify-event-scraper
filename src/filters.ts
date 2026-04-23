import type { EventItem, InputSchema, EventFormat, LocationInput } from './types';

/**
 * Calculate distance between two coordinates using Haversine formula.
 * Returns distance in kilometers.
 */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Filter events by keyword in name, description, or tags.
 * Case-insensitive substring match.
 */
export function filterByKeyword(query: string): (e: EventItem) => boolean {
  const q = query.toLowerCase();
  return (e) => {
    const text = `${e.name} ${e.description} ${(e.tags ?? []).join(' ')}`.toLowerCase();
    return text.includes(q);
  };
}

/**
 * Filter events by location. Supports two modes:
 * - City/country substring match (case-insensitive)
 * - Lat/lng/radiusKm haversine distance calculation
 */
export function filterByLocation(loc: LocationInput): (e: EventItem) => boolean {
  return (e) => {
    if (loc.lat !== undefined && loc.lng !== undefined && loc.radiusKm !== undefined) {
      const vLat = e.venue?.lat;
      const vLng = e.venue?.lng;
      if (vLat === undefined || vLng === undefined) return false;
      return haversineKm(loc.lat, loc.lng, vLat, vLng) <= loc.radiusKm;
    }
    if (loc.city) {
      const city = (e.venue?.city ?? '').toLowerCase();
      if (!city.includes(loc.city.toLowerCase())) return false;
    }
    if (loc.country) {
      const country = (e.venue?.country ?? '').toLowerCase();
      if (!country.includes(loc.country.toLowerCase())) return false;
    }
    return true;
  };
}

/**
 * Filter events by date range. Includes entire final day.
 */
export function filterByDate(dateFrom?: string, dateTo?: string): (e: EventItem) => boolean {
  const from = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
  const to = dateTo ? new Date(`${dateTo}T23:59:59Z`).getTime() : Infinity;
  return (e) => {
    const t = new Date(e.startAt).getTime();
    return t >= from && t <= to;
  };
}

/**
 * Filter events by format type (conference, meetup, workshop, etc).
 */
export function filterByEventType(types: EventFormat[]): (e: EventItem) => boolean {
  return (e) => types.includes(e.format);
}

/**
 * Filter events by industry keywords in description or tags.
 * Case-insensitive substring match.
 */
export function filterByIndustry(industries: string[]): (e: EventItem) => boolean {
  return (e) => {
    const text = `${e.description} ${(e.tags ?? []).join(' ')}`.toLowerCase();
    return industries.some((ind) => text.includes(ind.toLowerCase()));
  };
}

/**
 * Filter events by format: online or in-person.
 */
export function filterByFormat(format: 'online' | 'in-person'): (e: EventItem) => boolean {
  return (e) => (format === 'online' ? e.isOnline : !e.isOnline);
}

/**
 * Filter events by price: free or paid.
 */
export function filterByPrice(priceType: 'free' | 'paid'): (e: EventItem) => boolean {
  return (e) => (priceType === 'free' ? e.isFree : !e.isFree);
}

/**
 * Filter events by language. Accepts events with no language specified.
 */
export function filterByLanguage(language: string): (e: EventItem) => boolean {
  const lang = language.toLowerCase();
  return (e) => !e.language || e.language.toLowerCase() === lang;
}

/**
 * Apply all configured filters to events. Skips filters for undefined input fields.
 */
export function applyFilters(events: EventItem[], input: InputSchema): EventItem[] {
  let result = [...events];
  if (input.query) result = result.filter(filterByKeyword(input.query));
  if (input.location) result = result.filter(filterByLocation(input.location));
  if (input.dateFrom || input.dateTo) result = result.filter(filterByDate(input.dateFrom, input.dateTo));
  if (input.eventTypes?.length) result = result.filter(filterByEventType(input.eventTypes));
  if (input.industries?.length) result = result.filter(filterByIndustry(input.industries));
  if (input.format && input.format !== 'both') result = result.filter(filterByFormat(input.format));
  if (input.priceType && input.priceType !== 'both') result = result.filter(filterByPrice(input.priceType));
  if (input.language) result = result.filter(filterByLanguage(input.language));
  return result;
}
