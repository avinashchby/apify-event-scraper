export type SourceId = 'eventbrite' | 'meetup' | 'luma' | 'partiful' | 'hopin' | 'humanitix';
export type EventFormat = 'conference' | 'meetup' | 'workshop' | 'hackathon' | 'webinar' | 'summit' | 'other';
export type FormatFilter = 'online' | 'in-person' | 'both';
export type PriceFilter = 'free' | 'paid' | 'both';

export interface LocationInput {
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export interface InputSchema {
  sources: SourceId[];
  query?: string;
  location?: LocationInput;
  dateFrom?: string;
  dateTo?: string;
  eventTypes?: EventFormat[];
  industries?: string[];
  format?: FormatFilter;
  priceType?: PriceFilter;
  language?: string;
  maxResults: number;
  maxResultsPerSource: number;
}

export interface VenueInfo {
  name?: string;
  address?: string;
  city?: string;
  country?: string;
  lat?: number;
  lng?: number;
}

export interface SpeakerInfo {
  name: string;
  title?: string;
  company?: string;
}

export interface EventItem {
  name: string;
  url: string;
  startAt: string;
  endDate?: string;
  description: string;
  location: string;
  venue?: VenueInfo;
  isOnline: boolean;
  format: EventFormat;
  isFree: boolean;
  ticketPrice?: string;
  ticketUrl?: string;
  imageUrl?: string;
  organizer?: string;
  speakers?: SpeakerInfo[];
  tags?: string[];
  language?: string;
  source: SourceId;
  scrapedAt: string;
}
