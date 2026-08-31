// RSS/Atom feed logic for the RSS homepage type.
//
// Everything in this module is PURE and Obsidian-free so it can be unit-tested
// headlessly (the plugin's in-Obsidian harness cannot). The custom view
// (rss-view.ts) injects a real DOMParser-backed `XmlParse` and Obsidian's
// `requestUrl` at runtime; tests inject fakes.
//
// Requirement tags: FR2 (item shape), FR3 (fetch + TTL cache), FR4 (RSS 2.0 +
// Atom 1.0), FR6 (error / empty handling), NFR1 (sanitization).

/** One normalized feed item, common to RSS 2.0 and Atom. (FR2) */
export interface FeedItem {
	title: string;
	link: string;
	/** Raw (sanitized) publication date string, kept for the absolute hover label. */
	date: string;
	/** Parsed publication time in ms since epoch, or null if unparseable. */
	timestamp: number | null;
	/** Prettified category/tag labels from the feed. */
	categories: string[];
	summary: string;
}

/** A parsed feed: its own title plus its items. */
export interface ParsedFeed {
	feedTitle: string;
	items: FeedItem[];
}

/** parseFeed result — never throws across this boundary. (FR6) */
export type FeedResult =
	| { ok: true; feed: ParsedFeed }
	| { ok: false; error: string };

/**
 * Minimal DOM-like node the parser walks. Kept tiny and namespace-insensitive
 * (Atom uses namespaced elements) so a headless test can build a fake tree and
 * the runtime adapter can wrap real DOM Elements. `localName` is the tag's
 * local name, lower-cased.
 */
export interface FeedElement {
	localName: string;
	text: string;
	attr(name: string): string | null;
	/** First DIRECT child with this local name (used for title/date so an Atom feed title is not confused with an entry title). */
	firstChild(localName: string): FeedElement | null;
	/** All descendants with this local name (used to collect item/entry lists). */
	descendants(localName: string): FeedElement[];
}

/** Parses an XML string into a root FeedElement. MAY throw on invalid XML. */
export type XmlParse = (xml: string) => FeedElement;

/** Fetches a URL and returns its body text. Injected (Obsidian requestUrl at runtime). */
export type RequestUrlFn = (url: string) => Promise<{ status: number; text: string }>;

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
};

/** Decode named and numeric HTML entities to their characters. */
export function decodeEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
		if (code[0] === "#") {
			const cp = code[1] === "x" || code[1] === "X"
				? parseInt(code.slice(2), 16)
				: parseInt(code.slice(1), 10);
			return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : match;
		}
		const named = NAMED_ENTITIES[code.toLowerCase()];
		return named ?? match;
	});
}

/**
 * Reduce feed-derived markup to clean, readable plain text. (NFR1)
 *
 * Feed descriptions are HTML, and RSS often (double-)entity-encodes them, so a
 * single tag-strip leaves `&nbsp;`/`&lt;p&gt;` behind. Drop script/style
 * contents first, then strip tags and decode entities across two passes (which
 * resolves double-encoding and neutralizes any tag that a decoded entity
 * reveals), then clean whitespace.
 */
export function sanitizeText(value: string | null | undefined): string {
	if (!value) return "";
	let out = value;
	for (let pass = 0; pass < 2; pass++) {
		out = out.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ""); // drop script/style incl. contents
		out = out.replace(/<[^>]*>/g, ""); // strip remaining tags
		out = decodeEntities(out); // decode entities (may reveal more markup)
	}
	out = out.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<[^>]*>/g, ""); // final strip
	return out
		.replace(/[\x00-\x1f\x7f]/g, " ") // control chars
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Return the URL only if it is a safe http(s) link, else "". Control characters
 * (including tabs/newlines that could form `java\tscript:`) are stripped first
 * so no disallowed scheme can be smuggled through. (NFR1)
 */
export function sanitizeUrl(value: string | null | undefined): string {
	if (!value) return "";
	const cleaned = value.replace(/[\x00-\x20\x7f]/g, "").trim();
	if (/^https?:\/\//i.test(cleaned)) return cleaned;
	return "";
}

/** True while the cached fetch is still within its TTL window. (FR3) */
export function isFresh(fetchedAtMs: number, nowMs: number, ttlMinutes: number): boolean {
	if (!fetchedAtMs || ttlMinutes <= 0) return false;
	return nowMs - fetchedAtMs < ttlMinutes * 60_000;
}

/**
 * Format a raw feed date to a human-readable local date AND time
 * (e.g. "Aug 28, 2026, 10:00 PM"), or pass the sanitized original through if it
 * cannot be parsed. (FR2, revision R1)
 */
export function formatDate(raw: string | null | undefined): string {
	if (!raw) return "";
	const trimmed = raw.trim();
	const ms = Date.parse(trimmed);
	if (Number.isNaN(ms)) return sanitizeText(trimmed);
	return new Date(ms).toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

/** Parse a raw date string to epoch ms, or null when it cannot be parsed. */
export function parseTimestamp(raw: string | null | undefined): number | null {
	if (!raw) return null;
	const ms = Date.parse(raw.trim());
	return Number.isNaN(ms) ? null : ms;
}

/**
 * A relative "time ago" label (e.g. "just now", "11 minutes ago", "2 hours
 * ago", "3 days ago"). Future timestamps collapse to "just now". (revision R2.1)
 */
export function formatRelative(ms: number | null, nowMs: number): string {
	if (ms === null || !Number.isFinite(ms)) return "";
	const sec = Math.round((nowMs - ms) / 1000);
	if (sec < 45) return "just now";
	const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
	const min = Math.round(sec / 60);
	if (min < 60) return plural(min, "minute");
	const hr = Math.round(min / 60);
	if (hr < 24) return plural(hr, "hour");
	const day = Math.round(hr / 24);
	if (day < 30) return plural(day, "day");
	const mon = Math.round(day / 30);
	if (mon < 12) return plural(mon, "month");
	return plural(Math.round(mon / 12), "year");
}

/** Reduce a taxonomy-style category token to its readable leaf label. */
function prettifyCategory(value: string): string {
	let leaf = sanitizeText(value);
	if (!leaf) return "";
	if (leaf.includes("/")) leaf = leaf.slice(leaf.lastIndexOf("/") + 1);
	else if (leaf.includes(":")) leaf = leaf.slice(leaf.lastIndexOf(":") + 1);
	return leaf.trim();
}

/**
 * Collect category labels from an item/entry. RSS uses `<category>` element
 * text (which AWS packs comma-separated); Atom uses a `term` attribute.
 * Prettified to leaf labels and deduped. (revision R2.2)
 */
export function parseCategories(el: FeedElement): string[] {
	const out: string[] = [];
	for (const cat of el.descendants("category")) {
		const term = cat.attr("term");
		const source = term ?? cat.text ?? "";
		for (const piece of source.split(",")) {
			const label = prettifyCategory(piece);
			if (label && !out.includes(label)) out.push(label);
		}
	}
	return out;
}

/** Which feed dialect the root element represents. */
export function detectFormat(root: FeedElement): "rss" | "atom" | "unknown" {
	const name = root.localName.toLowerCase();
	if (name === "feed") return "atom";
	if (name === "rss" || root.firstChild("channel")) return "rss";
	return "unknown";
}

function parseRss(root: FeedElement): ParsedFeed {
	const channel = root.firstChild("channel") ?? root;
	const feedTitle = sanitizeText(channel.firstChild("title")?.text);
	const items = channel.descendants("item").map((item) => {
		const rawDate = item.firstChild("pubDate")?.text ?? item.firstChild("date")?.text ?? "";
		return {
			title: sanitizeText(item.firstChild("title")?.text),
			link: sanitizeUrl(item.firstChild("link")?.text),
			date: sanitizeText(rawDate),
			timestamp: parseTimestamp(rawDate),
			categories: parseCategories(item),
			summary: sanitizeText(item.firstChild("description")?.text),
		};
	});
	return { feedTitle, items };
}

function atomLink(entry: FeedElement): string {
	const links = entry.descendants("link");
	// Prefer rel="alternate" (or unspecified rel), else the first link.
	const alternate = links.find((l) => {
		const rel = l.attr("rel");
		return rel === null || rel === "alternate";
	});
	const chosen = alternate ?? links[0];
	return sanitizeUrl(chosen?.attr("href") ?? chosen?.text ?? "");
}

function parseAtom(root: FeedElement): ParsedFeed {
	const feedTitle = sanitizeText(root.firstChild("title")?.text);
	const items = root.descendants("entry").map((entry) => {
		const rawDate = entry.firstChild("updated")?.text ?? entry.firstChild("published")?.text ?? "";
		return {
			title: sanitizeText(entry.firstChild("title")?.text),
			link: atomLink(entry),
			date: sanitizeText(rawDate),
			timestamp: parseTimestamp(rawDate),
			categories: parseCategories(entry),
			summary: sanitizeText(entry.firstChild("summary")?.text ?? entry.firstChild("content")?.text),
		};
	});
	return { feedTitle, items };
}

/**
 * Parse a feed document into the common shape. Accepts an injected XML parser
 * so it needs no real DOMParser headlessly. Returns a typed error result on
 * invalid XML or an unrecognized dialect; a valid feed with no items returns
 * an empty `items` array (not an error). (FR2, FR4, FR6)
 */
export function parseFeed(xml: string, parseXml: XmlParse): FeedResult {
	let root: FeedElement;
	try {
		root = parseXml(xml);
	} catch (e) {
		return { ok: false, error: `Could not parse feed: ${e instanceof Error ? e.message : String(e)}` };
	}
	const format = detectFormat(root);
	if (format === "rss") return { ok: true, feed: parseRss(root) };
	if (format === "atom") return { ok: true, feed: parseAtom(root) };
	return { ok: false, error: "Unrecognized feed format (expected RSS 2.0 or Atom)." };
}

/** Fetch a feed's raw XML through the injected client. (FR3, error handling at the boundary) */
export async function fetchFeed(
	url: string,
	requestUrlFn: RequestUrlFn,
): Promise<{ ok: true; xml: string } | { ok: false; error: string }> {
	const safe = sanitizeUrl(url);
	if (!safe) return { ok: false, error: "The feed URL must be a valid http(s) address." };
	try {
		const res = await requestUrlFn(safe);
		if (res.status < 200 || res.status >= 300) {
			return { ok: false, error: `Feed request failed (HTTP ${res.status}).` };
		}
		if (!res.text) return { ok: false, error: "The feed response was empty." };
		return { ok: true, xml: res.text };
	} catch (e) {
		return { ok: false, error: `Feed unreachable: ${e instanceof Error ? e.message : String(e)}` };
	}
}

interface CacheEntry {
	feed: ParsedFeed;
	fetchedAt: number;
}

/** In-memory last-successful-feed cache, keyed by sanitized URL. (FR3) */
export class FeedCache {
	private store = new Map<string, CacheEntry>();

	get(url: string): CacheEntry | undefined {
		return this.store.get(url);
	}

	set(url: string, feed: ParsedFeed, fetchedAt: number): void {
		this.store.set(url, { feed, fetchedAt });
	}
}

/** The resolved feed state a view renders. */
export interface FeedLoad {
	feed: ParsedFeed | null;
	stale: boolean;
	error: string | null;
}

/**
 * Fetch-through-cache orchestration. Serves fresh cache within the TTL; on a
 * failed refresh falls back to stale cache with a notice, else surfaces the
 * error. (FR3, FR6)
 */
export async function loadFeed(
	url: string,
	ttlMinutes: number,
	nowMs: number,
	cache: FeedCache,
	requestUrlFn: RequestUrlFn,
	parseXml: XmlParse,
): Promise<FeedLoad> {
	const safe = sanitizeUrl(url);
	if (!safe) return { feed: null, stale: false, error: "The feed URL must be a valid http(s) address." };

	const cached = cache.get(safe);
	if (cached && isFresh(cached.fetchedAt, nowMs, ttlMinutes)) {
		return { feed: cached.feed, stale: false, error: null };
	}

	const fetched = await fetchFeed(safe, requestUrlFn);
	if (!fetched.ok) {
		if (cached) return { feed: cached.feed, stale: true, error: fetched.error };
		return { feed: null, stale: false, error: fetched.error };
	}

	const parsed = parseFeed(fetched.xml, parseXml);
	if (!parsed.ok) {
		if (cached) return { feed: cached.feed, stale: true, error: parsed.error };
		return { feed: null, stale: false, error: parsed.error };
	}

	cache.set(safe, parsed.feed, nowMs);
	return { feed: parsed.feed, stale: false, error: null };
}
