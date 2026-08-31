import { describe, it, expect } from "vitest";
import { parseFeed } from "../../src/rss/parser";

const RSS_2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
	<channel>
		<title>Example</title>
		<item>
			<title>First post</title>
			<link>https://example.com/first</link>
			<pubDate>Wed, 27 Aug 2025 10:00:00 GMT</pubDate>
			<category>News</category>
			<category>Tech</category>
			<description><![CDATA[<p>Hello <b>world</b></p>]]></description>
		</item>
		<item>
			<title>Undated post</title>
			<link>https://example.com/undated</link>
			<description>Plain summary</description>
		</item>
	</channel>
</rss>`;

const ATOM_1 = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
	<title>Example</title>
	<entry>
		<title>Atom entry</title>
		<link rel="alternate" href="https://example.com/atom-1"/>
		<link rel="edit" href="https://example.com/edit"/>
		<published>2025-08-27T10:00:00Z</published>
		<updated>2025-08-28T10:00:00Z</updated>
		<category term="Release"/>
		<summary>An atom summary</summary>
	</entry>
	<entry>
		<title>Updated only</title>
		<link href="https://example.com/atom-2"/>
		<updated>2025-08-20T10:00:00Z</updated>
	</entry>
</feed>`;

describe("parseFeed — RSS 2.0", () => {
	it("extracts title, link, date, categories and summary (FR3.1, FR3.3)", () => {
		const items = parseFeed(RSS_2);
		expect(items).toHaveLength(2);

		const first = items[0];
		expect(first.title).toBe("First post");
		expect(first.link).toBe("https://example.com/first");
		expect(first.date).toBe(Date.parse("Wed, 27 Aug 2025 10:00:00 GMT"));
		expect(first.categories).toEqual(["News", "Tech"]);
		expect(first.summaryHtml).toContain("<b>world</b>");
	});

	it("leaves date null for an item without pubDate (FR3.4)", () => {
		const items = parseFeed(RSS_2);
		expect(items[1].date).toBeNull();
		expect(items[1].categories).toEqual([]);
	});
});

describe("parseFeed — Atom 1.0", () => {
	it("uses the alternate link, published date, and term categories (FR3.2, FR3.3)", () => {
		const items = parseFeed(ATOM_1);
		expect(items).toHaveLength(2);

		const first = items[0];
		expect(first.title).toBe("Atom entry");
		expect(first.link).toBe("https://example.com/atom-1");
		expect(first.date).toBe(Date.parse("2025-08-27T10:00:00Z"));
		expect(first.categories).toEqual(["Release"]);
		expect(first.summaryHtml).toBe("An atom summary");
	});

	it("falls back to <updated> when <published> is absent (FR3.3)", () => {
		const items = parseFeed(ATOM_1);
		expect(items[1].date).toBe(Date.parse("2025-08-20T10:00:00Z"));
		expect(items[1].link).toBe("https://example.com/atom-2");
	});
});

describe("parseFeed — errors", () => {
	it("throws on empty input (FR3.5)", () => {
		expect(() => parseFeed("")).toThrow();
	});

	it("throws on a document that is neither RSS nor Atom (FR3.5)", () => {
		expect(() => parseFeed("<html><body>not a feed</body></html>")).toThrow();
	});
});
