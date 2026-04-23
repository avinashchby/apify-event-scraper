import type { EventItem } from './types';

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, '').replace(/^https?:\/\//, '').toLowerCase();
}

function titleDateKey(name: string, startAt: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  const date = startAt.slice(0, 10);
  return `${slug}|${date}`;
}

export function deduplicate(events: EventItem[]): EventItem[] {
  const seenUrls = new Set<string>();
  const seenTitleDates = new Set<string>();
  const result: EventItem[] = [];

  for (const event of events) {
    const urlKey = normalizeUrl(event.url);
    const tdKey = titleDateKey(event.name, event.startAt);

    if (seenUrls.has(urlKey) || seenTitleDates.has(tdKey)) continue;

    seenUrls.add(urlKey);
    seenTitleDates.add(tdKey);
    result.push(event);
  }

  return result;
}
