// Shared types for the RSS homepage type.
// Pure data definitions — no Obsidian imports, so this module (and the parser /
// format helpers that use it) is unit-testable outside the Obsidian runtime.

/** A single normalized feed entry, produced by parseFeed(). */
export interface FeedItem {
	/** Item title (plain text). Empty string when the feed omits one. */
	title: string;
	/** Absolute link to the item, opened externally when the card is clicked. */
	link: string;
	/**
	 * Publication time as epoch milliseconds, or null when the feed item has no
	 * parseable date. Undated items render without a "time ago" and sort last.
	 */
	date: number | null;
	/** Category / tag labels attached to the item. */
	categories: string[];
	/** Raw summary/description HTML from the feed (sanitized at render time). */
	summaryHtml: string;
}

/** Last-good fetch, persisted per homepage via the plugin's data.json. */
export interface RssCache {
	/** Epoch ms of the successful fetch that produced `items`. */
	fetchedAt: number;
	/** The feed URL this cache was fetched from (invalidated when the URL changes). */
	feedUrl: string;
	/** Parsed, sorted, capped items from the last good fetch. */
	items: FeedItem[];
}

/** Maximum number of item cards rendered (FR4.2). */
export const MAX_ITEMS = 50;

/** Minimum allowed refresh interval in minutes (NFR3). */
export const MIN_REFRESH_MINUTES = 5;

/** Default refresh interval in minutes (FR1.4). */
export const DEFAULT_REFRESH_MINUTES = 60;

/** Feed fetch timeout in milliseconds (NFR3). */
export const FETCH_TIMEOUT_MS = 30_000;
