import type { InputSchema, EventItem } from '../types';

export interface ScraperOptions {
  input: InputSchema;
  fetchFn?: typeof globalThis.fetch;
}

export abstract class BaseScraper {
  protected input: InputSchema;
  protected fetch: typeof globalThis.fetch;

  constructor(options: ScraperOptions) {
    this.input = options.input;
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  abstract scrape(): Promise<EventItem[]>;

  protected get maxResults(): number {
    return this.input.maxResultsPerSource ?? 50;
  }

  /** Retry fn up to `retries` times with exponential backoff. */
  protected async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let lastError: Error = new Error('Unknown');
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    }
    throw lastError;
  }

  /** Random delay 500–2000 ms — use in Playwright scrapers to avoid bot detection. */
  protected async randomDelay(): Promise<void> {
    const ms = 500 + Math.random() * 1500;
    await new Promise((r) => setTimeout(r, ms));
  }
}
