// Headless unit tests for the pure RSS feed logic (src/rss.ts).
//
// Run scoped to this file only (the in-Obsidian *-tests.ts harness is separate
// and untouched):
//
//   cd homepage && bun test tests/rss.unit.test.ts
//
// One test per requirement (Minimal / test-after): FR4/FR2 (RSS 2.0), FR4
// (Atom), NFR1 (sanitization), FR3 (cache TTL), FR6 (parse failure), FR6
// (valid-but-empty feed), plus a happy-path cache-fallback check.

import { test, expect } from "bun:test";
import {
	FeedElement,
	FeedCache,
	formatDate,
	formatRelative,
	isFresh,
	loadFeed,
	parseFeed,
	sanitizeText,
	sanitizeUrl,
} from "../src/rss";

// --- Tiny FeedElement builder so the parser can be tested without a DOM ------

interface Node {
	localName: string;
	text?: string;
	attrs?: Record<string, string>;
	children?: Node[];
}

function make(node: Node): FeedElement {
	const childNodes = (node.children ?? []).map(make);
	return {
		localName: node.localName.toLowerCase(),
		text: node.text ?? "",
		attr: (name) => node.attrs?.[name] ?? null,
		firstChild: (ln) => childNodes.find((c) => c.localName === ln.toLowerCase()) ?? null,
		descendants: (ln) => {
			const target = ln.toLowerCase();
			const out: FeedElement[] = [];
			for (const child of childNodes) {
				if (child.localName === target) out.push(child);
				out.push(...child.descendants(target));
			}
			return out;
		},
	};
}

const rssRoot = make({
	localName: "rss",
	children: [
		{
			localName: "channel",
			children: [
				{ localName: "title", text: "Example Feed" },
				{
					localName: "item",
					children: [
						{ localName: "title", text: "First post" },
						{ localName: "link", text: "https://example.com/1" },
						{ localName: "pubDate", text: "Wed, 02 Oct 2024 13:00:00 GMT" },
						{ localName: "category", text: "general:products/amazon-ec2,marketing:marchitecture/compute" },
						{ localName: "description", text: "A short summary." },
					],
				},
			],
		},
	],
});

const atomRoot = make({
	localName: "feed",
	children: [
		{ localName: "title", text: "Atom Example" },
		{
			localName: "entry",
			children: [
				{ localName: "title", text: "Atom post" },
				{ localName: "link", attrs: { href: "https://example.com/a1", rel: "alternate" } },
				{ localName: "updated", text: "2024-10-02T13:00:00Z" },
				{ localName: "category", attrs: { term: "announcements" } },
				{ localName: "summary", text: "Atom summary." },
			],
		},
	],
});

// FR4 / FR2 — RSS 2.0 parses into the common item shape.
test("parses an RSS 2.0 feed into common items", () => {
	const result = parseFeed("<ignored/>", () => rssRoot);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.feed.feedTitle).toBe("Example Feed");
	expect(result.feed.items).toHaveLength(1);
	expect(result.feed.items[0].title).toBe("First post");
	expect(result.feed.items[0].link).toBe("https://example.com/1");
	expect(result.feed.items[0].summary).toBe("A short summary.");
	expect(result.feed.items[0].date).not.toBe("");
	expect(result.feed.items[0].timestamp).not.toBeNull();
	// RSS comma-separated taxonomy category is split and reduced to leaf labels.
	expect(result.feed.items[0].categories).toEqual(["amazon-ec2", "compute"]);
});

// R1 — dates render in a human-readable format that includes the time of day.
test("formatDate produces a human-readable date and time", () => {
	const out = formatDate("Wed, 02 Oct 2024 13:00:00 GMT");
	expect(out).not.toBe("");
	expect(out).toContain("2024");
	expect(out).toMatch(/\d:\d\d/); // a time component is present
	// An unparseable value passes through (sanitized) rather than becoming empty.
	expect(formatDate("not a date")).toBe("not a date");
});

// FR4 — Atom 1.0 parses into the same shape, resolving the alternate link href.
test("parses an Atom 1.0 feed into common items", () => {
	const result = parseFeed("<ignored/>", () => atomRoot);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.feed.feedTitle).toBe("Atom Example");
	expect(result.feed.items).toHaveLength(1);
	expect(result.feed.items[0].title).toBe("Atom post");
	expect(result.feed.items[0].link).toBe("https://example.com/a1");
	expect(result.feed.items[0].summary).toBe("Atom summary.");
	expect(result.feed.items[0].categories).toEqual(["announcements"]);
});

// R2.1 — relative time labels.
test("formatRelative renders human relative time", () => {
	const now = 1_000_000_000_000;
	expect(formatRelative(now - 10_000, now)).toBe("just now");
	expect(formatRelative(now - 11 * 60_000, now)).toBe("11 minutes ago");
	expect(formatRelative(now - 60_000, now)).toBe("1 minute ago");
	expect(formatRelative(now - 2 * 3_600_000, now)).toBe("2 hours ago");
	expect(formatRelative(now - 3 * 86_400_000, now)).toBe("3 days ago");
	expect(formatRelative(null, now)).toBe("");
});

// NFR1 — feed-derived text and links are neutralized.
test("sanitizes markup and unsafe links", () => {
	expect(sanitizeText("<script>alert(1)</script>Hello")).toBe("Hello");
	expect(sanitizeUrl("javascript:alert(1)")).toBe("");
	expect(sanitizeUrl("java\tscript:alert(1)")).toBe("");
	expect(sanitizeUrl("https://example.com/ok")).toBe("https://example.com/ok");
});

// R3.1 — HTML entities in the body are decoded to clean text (single, double, numeric).
test("decodes HTML entities in feed body text", () => {
	// Single-encoded tags + entity (the common RSS description case).
	expect(sanitizeText("<p>Hello&nbsp;world</p>")).toBe("Hello world");
	// Double-encoded (AWS packs &amp;nbsp; inside an entity-escaped body).
	expect(sanitizeText("&lt;p&gt;Hi&amp;nbsp;there&lt;/p&gt;")).toBe("Hi there");
	// Named + numeric entities resolve.
	expect(sanitizeText("Tom &amp; Jerry &#38; friends")).toBe("Tom & Jerry & friends");
	expect(sanitizeText("caf&#233; &mdash; open")).toBe("café — open");
	// A tag revealed by decoding is still stripped (defense in depth).
	expect(sanitizeText("&lt;script&gt;evil()&lt;/script&gt;ok")).toBe("ok");
});

// FR3 — cache freshness by configurable TTL (1 / 5 / 60 minutes).
test("isFresh honors the configured TTL window", () => {
	const base = 1_000_000;
	expect(isFresh(base, base + 59_000, 1)).toBe(true);
	expect(isFresh(base, base + 61_000, 1)).toBe(false);
	expect(isFresh(base, base + 4 * 60_000, 5)).toBe(true);
	expect(isFresh(base, base + 6 * 60_000, 5)).toBe(false);
	expect(isFresh(base, base + 59 * 60_000, 60)).toBe(true);
	expect(isFresh(base, base + 61 * 60_000, 60)).toBe(false);
	expect(isFresh(0, base, 5)).toBe(false); // no prior fetch
});

// FR6 — a parse failure surfaces as a typed error, never a throw.
test("returns an error result when XML parsing fails", () => {
	const result = parseFeed("not xml", () => {
		throw new Error("malformed XML");
	});
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error).toContain("parse");
});

// FR6 — a valid feed with no items returns zero items, not an error.
test("returns zero items for a valid but empty feed", () => {
	const emptyRoot = make({
		localName: "rss",
		children: [{ localName: "channel", children: [{ localName: "title", text: "Empty" }] }],
	});
	const result = parseFeed("<ignored/>", () => emptyRoot);
	expect(result.ok).toBe(true);
	if (!result.ok) return;
	expect(result.feed.items).toHaveLength(0);
});

// FR3 / FR6 — on a failed refresh, loadFeed falls back to stale cache.
test("loadFeed serves stale cache with a flag when a refresh fails", async () => {
	const cache = new FeedCache();
	const url = "https://example.com/feed.xml";
	cache.set(url, { feedTitle: "Cached", items: [] }, 0); // stale (fetched at t=0)

	const failing = async () => {
		throw new Error("network down");
	};
	const result = await loadFeed(url, 5, 10 * 60_000, cache, failing, () => rssRoot);
	expect(result.feed?.feedTitle).toBe("Cached");
	expect(result.stale).toBe(true);
	expect(result.error).not.toBeNull();
});
