import { Actor } from 'apify';
import type { InputSchema, EventItem, SourceId } from './types';
import { EventbriteScraper } from './scrapers/eventbrite';
import { MeetupScraper } from './scrapers/meetup';
import { LumaScraper } from './scrapers/luma';
import { PartifulScraper } from './scrapers/partiful';
import { HopinScraper } from './scrapers/hopin';
import { HumanitixScraper } from './scrapers/humanitix';
import { applyFilters } from './filters';
import { deduplicate } from './deduplicator';

const DEFAULT_SOURCES: SourceId[] = ['eventbrite', 'meetup', 'luma', 'partiful', 'hopin', 'humanitix'];

interface RunStats {
  source: SourceId;
  fetched: number;
  filtered: number;
  errors: number;
}

async function main(): Promise<void> {
  await Actor.init();
  try {
    const rawInput = await Actor.getInput<Partial<InputSchema>>();
    const input: InputSchema = {
      sources: rawInput?.sources ?? DEFAULT_SOURCES,
      query: rawInput?.query,
      location: rawInput?.location,
      dateFrom: rawInput?.dateFrom,
      dateTo: rawInput?.dateTo,
      eventTypes: rawInput?.eventTypes,
      industries: rawInput?.industries,
      format: rawInput?.format ?? 'both',
      priceType: rawInput?.priceType ?? 'both',
      language: rawInput?.language,
      maxResults: rawInput?.maxResults ?? 200,
      maxResultsPerSource: rawInput?.maxResultsPerSource ?? 50,
    };

    const scraperMap: Record<SourceId, () => Promise<EventItem[]>> = {
      eventbrite: () => new EventbriteScraper({ input }).scrape(),
      meetup: () => new MeetupScraper({ input }).scrape(),
      luma: () => new LumaScraper({ input }).scrape(),
      partiful: () => new PartifulScraper({ input }).scrape(),
      hopin: () => new HopinScraper({ input }).scrape(),
      humanitix: () => new HumanitixScraper({ input }).scrape(),
    };

    const allEvents: EventItem[] = [];
    const stats: RunStats[] = [];

    // Run scrapers sequentially — Playwright-based scrapers each consume ~1GB RAM,
    // running them concurrently exceeds Apify's 4GB memory limit.
    for (const source of input.sources) {
      try {
        const events = await scraperMap[source]();
        const filtered = applyFilters(events, input);
        stats.push({ source, fetched: events.length, filtered: filtered.length, errors: 0 });
        allEvents.push(...filtered);
        console.log(`[${source}] fetched=${events.length} filtered=${filtered.length}`);
      } catch (err) {
        stats.push({ source, fetched: 0, filtered: 0, errors: 1 });
        console.error(`[${source}] failed:`, err);
      }
    }

    const deduped = deduplicate(allEvents).slice(0, input.maxResults);

    if (deduped.length === 0) {
      console.warn('Warning: no events matched the filters');
    }

    const dataset = await Actor.openDataset();
    await dataset.pushData(deduped);

    console.log(`Done. Total events after dedup: ${deduped.length}`);
    console.log('Per-source stats:', JSON.stringify(stats, null, 2));

    await Actor.exit();
  } catch (err) {
    console.error('Fatal error in main:', err);
    await Actor.exit({ exitCode: 1 });
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
