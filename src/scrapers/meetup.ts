import type { EventItem, VenueInfo } from '../types';
import { parseDate, stripHtml, detectFormat, buildLocation } from '../utils/normalize';
import { BaseScraper, ScraperOptions } from './base';

const GRAPHQL_URL = 'https://api.meetup.com/gql';

const SEARCH_QUERY = `
query SearchEvents($query: String!, $lat: Float, $lon: Float, $radius: Int) {
  keywordSearch(
    filter: { query: $query, lat: $lat, lon: $lon, radius: $radius }
    input: { first: 50 }
    sort: { sortField: DATETIME }
  ) {
    edges {
      node {
        ... on Event {
          id
          title
          dateTime
          endTime
          description
          eventUrl
          isOnline
          venue { name city state country lat lon }
          feeSettings { amount currency }
          group { name }
          featuredEventPhoto { highResUrl }
        }
      }
    }
    pageInfo { endCursor hasNextPage }
  }
}`;

interface MeetupEvent {
  id: string;
  title: string;
  dateTime: string;
  endTime?: string;
  description?: string;
  eventUrl: string;
  isOnline: boolean;
  venue?: { name?: string; city?: string; state?: string; country?: string; lat?: number; lon?: number };
  feeSettings?: { amount?: number; currency?: string } | null;
  group?: { name?: string };
  featuredEventPhoto?: { highResUrl?: string };
}

interface MeetupResponse {
  data?: {
    keywordSearch?: {
      edges?: { node?: MeetupEvent }[];
    };
  };
}

/** Scrapes events from Meetup's public GraphQL API. */
export class MeetupScraper extends BaseScraper {
  constructor(options: ScraperOptions) {
    super(options);
  }

  async scrape(): Promise<EventItem[]> {
    const loc = this.input.location;
    const variables: Record<string, unknown> = {
      query: this.input.query ?? '',
      lat: loc?.lat,
      lon: loc?.lng,
      radius: loc?.radiusKm ? Math.round(loc.radiusKm * 0.621371) : undefined,
    };

    const res = await this.withRetry(() =>
      this.fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: SEARCH_QUERY, variables }),
      })
    );

    if (!res.ok) throw new Error(`Meetup HTTP ${res.status}`);

    const json = (await res.json()) as MeetupResponse;
    const edges = json.data?.keywordSearch?.edges ?? [];
    const now = new Date().toISOString();

    return edges
      .map((e) => e.node)
      .filter((n): n is MeetupEvent => !!n?.eventUrl)
      .slice(0, this.maxResults)
      .map((ev) => this.normalizeEvent(ev, now));
  }

  private normalizeEvent(ev: MeetupEvent, scrapedAt: string): EventItem {
    const city = ev.venue?.city;
    const country = ev.venue?.country?.toUpperCase();
    const venue: VenueInfo = {
      name: ev.venue?.name,
      city,
      country,
      lat: ev.venue?.lat,
      lng: ev.venue?.lon,
    };
    const desc = stripHtml(ev.description ?? '');
    const isFree = !ev.feeSettings?.amount || ev.feeSettings.amount === 0;

    return {
      name: ev.title,
      url: ev.eventUrl,
      startAt: parseDate(ev.dateTime),
      endDate: ev.endTime ? parseDate(ev.endTime) : undefined,
      description: desc,
      location: buildLocation(city, country),
      venue,
      isOnline: ev.isOnline,
      format: detectFormat(ev.title, desc),
      isFree,
      ticketPrice: isFree
        ? 'Free'
        : `${ev.feeSettings?.amount ?? ''} ${ev.feeSettings?.currency ?? ''}`.trim(),
      imageUrl: ev.featuredEventPhoto?.highResUrl,
      organizer: ev.group?.name,
      source: 'meetup',
      scrapedAt,
    };
  }
}
