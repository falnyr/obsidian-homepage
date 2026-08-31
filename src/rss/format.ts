// Pure date/format/sort/validation helpers for the RSS homepage type.
// No Obsidian imports — unit-testable headlessly.

import { FeedItem, MAX_ITEMS } from "./types";

/**
 * Parse a feed publication date to epoch milliseconds.
 * Handles RSS 2.0 RFC-822 dates and Atom 1.0 RFC-3339 dates (both accepted by
 * the JS Date parser). Returns null for empty or unparseable input (FR3.3,
 * FR3.4).
 */
export function parseFeedDate(raw: string): number | null {
	if (!raw || raw.trim() === "") return null;
	const ms = Date.parse(raw.trim());
	return Number.isNaN(ms) ? null : ms;
}

/**
 * Relative "time ago" string for an epoch-ms timestamp (FR4.4).
 * Future timestamps clamp to "just now".
 */
export function timeAgo(ms: number, now: number): string {
	const diff = Math.max(0, now - ms);
	const sec = Math.floor(diff / 1000);
	if (sec < 60) return "just now";
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.floor(hr / 24);
	if (day < 7) return `${day}d ago`;
	const wk = Math.floor(day / 7);
	if (wk < 5) return `${wk}w ago`;
	const mo = Math.floor(day / 30);
	if (mo < 12) return `${mo}mo ago`;
	const yr = Math.floor(day / 365);
	return `${yr}y ago`;
}

/**
 * Sort items newest-first by date, place undated items last, and cap the list
 * (FR3.4, FR4.2). Does not mutate the input array.
 */
export function sortAndCap(items: FeedItem[], max: number = MAX_ITEMS): FeedItem[] {
	const sorted = [...items].sort((a, b) => {
		if (a.date === null && b.date === null) return 0;
		if (a.date === null) return 1; // a is undated -> after b
		if (b.date === null) return -1; // b is undated -> after a
		return b.date - a.date; // newest first
	});
	return sorted.slice(0, max);
}

/**
 * Decide whether to re-fetch on open using the freshness window (FR2.2).
 * Returns true when there is no prior fetch, or the interval has elapsed since
 * the last fetch. `intervalMinutes` is clamped to a non-negative number.
 */
export function shouldRefetch(lastAt: number | null, intervalMinutes: number, now: number): boolean {
	if (lastAt === null) return true;
	const interval = Math.max(0, intervalMinutes) * 60 * 1000;
	return now - lastAt >= interval;
}

/**
 * Validate a feed URL: non-empty, well-formed, and http/https only (FR1.3,
 * NFR1). Rejects other schemes to avoid unsafe fetch targets.
 */
export function isValidFeedUrl(url: string): boolean {
	if (!url || url.trim() === "") return false;
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		return false;
	}
	return parsed.protocol === "http:" || parsed.protocol === "https:";
}
