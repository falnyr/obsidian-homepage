import { describe, it, expect } from "vitest";
import { parseFeedDate, timeAgo, sortAndCap, shouldRefetch, isValidFeedUrl } from "../../src/rss/format";
import { FeedItem } from "../../src/rss/types";

function item(date: number | null): FeedItem {
	return { title: "t", link: "https://e/x", date, categories: [], summaryHtml: "" };
}

describe("parseFeedDate (FR3.3, FR3.4)", () => {
	it("parses RFC-822 (RSS) and RFC-3339 (Atom) dates", () => {
		expect(parseFeedDate("Wed, 27 Aug 2025 10:00:00 GMT")).toBe(Date.parse("Wed, 27 Aug 2025 10:00:00 GMT"));
		expect(parseFeedDate("2025-08-27T10:00:00Z")).toBe(Date.parse("2025-08-27T10:00:00Z"));
	});

	it("returns null for empty or unparseable input", () => {
		expect(parseFeedDate("")).toBeNull();
		expect(parseFeedDate("   ")).toBeNull();
		expect(parseFeedDate("not a date")).toBeNull();
	});
});

describe("timeAgo (FR4.4)", () => {
	const now = Date.parse("2025-08-27T12:00:00Z");

	it("formats recent offsets sensibly", () => {
		expect(timeAgo(now - 30 * 1000, now)).toBe("just now");
		expect(timeAgo(now - 5 * 60 * 1000, now)).toBe("5m ago");
		expect(timeAgo(now - 3 * 60 * 60 * 1000, now)).toBe("3h ago");
		expect(timeAgo(now - 2 * 24 * 60 * 60 * 1000, now)).toBe("2d ago");
	});

	it("clamps future timestamps to just now", () => {
		expect(timeAgo(now + 60 * 1000, now)).toBe("just now");
	});
});

describe("sortAndCap (FR3.4, FR4.2)", () => {
	it("orders dated items newest-first and places undated items last", () => {
		const items = [item(100), item(null), item(300), item(200)];
		const sorted = sortAndCap(items);
		expect(sorted.map(i => i.date)).toEqual([300, 200, 100, null]);
	});

	it("caps the list at the maximum", () => {
		const many = Array.from({ length: 60 }, (_, i) => item(i));
		expect(sortAndCap(many)).toHaveLength(50);
	});
});

describe("shouldRefetch (FR2.2)", () => {
	const now = 10_000_000;

	it("returns true when there is no prior fetch", () => {
		expect(shouldRefetch(null, 60, now)).toBe(true);
	});

	it("returns false inside the freshness window and true once elapsed", () => {
		const tenMinAgo = now - 10 * 60 * 1000;
		expect(shouldRefetch(tenMinAgo, 60, now)).toBe(false);
		const twoHoursAgo = now - 120 * 60 * 1000;
		expect(shouldRefetch(twoHoursAgo, 60, now)).toBe(true);
	});
});

describe("isValidFeedUrl (FR1.3, NFR1)", () => {
	it("accepts http and https URLs", () => {
		expect(isValidFeedUrl("https://example.com/feed.xml")).toBe(true);
		expect(isValidFeedUrl("http://example.com/rss")).toBe(true);
	});

	it("rejects empty, malformed, and non-http(s) schemes", () => {
		expect(isValidFeedUrl("")).toBe(false);
		expect(isValidFeedUrl("not a url")).toBe(false);
		expect(isValidFeedUrl("ftp://example.com/feed")).toBe(false);
		expect(isValidFeedUrl("javascript:alert(1)")).toBe(false);
	});
});
