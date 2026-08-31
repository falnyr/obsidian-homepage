// RSS 2.0 and Atom 1.0 feed parsing. Pure logic — depends only on the DOM
// `DOMParser`, which is provided by the Obsidian runtime and by jsdom in tests.
// No Obsidian imports, so this is unit-testable headlessly.

import { FeedItem } from "./types";
import { parseFeedDate } from "./format";

/**
 * Parse a raw feed document (RSS 2.0 or Atom 1.0) into normalized items.
 *
 * @throws Error when the input is empty, not XML, or is neither RSS 2.0 nor
 *   Atom 1.0. Callers treat a throw as a fetch failure (FR3.5) and fall back to
 *   cache.
 */
export function parseFeed(xml: string): FeedItem[] {
	if (!xml || xml.trim() === "") {
		throw new Error("Empty feed response");
	}

	const doc = new DOMParser().parseFromString(xml, "text/xml");

	// A parse error surfaces as a <parsererror> element in the resulting document.
	if (doc.getElementsByTagName("parsererror").length > 0) {
		throw new Error("Feed is not well-formed XML");
	}

	const root = doc.documentElement;
	if (!root) {
		throw new Error("Feed has no root element");
	}

	const rootName = localName(root);

	if (rootName === "rss" || root.getElementsByTagName("channel").length > 0) {
		return parseRss(doc);
	}
	if (rootName === "feed") {
		return parseAtom(doc);
	}

	throw new Error("Unrecognized feed format (expected RSS 2.0 or Atom 1.0)");
}

function parseRss(doc: Document): FeedItem[] {
	const items: FeedItem[] = [];

	for (const item of Array.from(doc.getElementsByTagName("item"))) {
		items.push({
			title: text(child(item, "title")),
			link: text(child(item, "link")),
			date: parseFeedDate(text(child(item, "pubDate"))),
			categories: Array.from(item.getElementsByTagName("category"))
				.map(c => textContent(c))
				.filter(c => c.length > 0),
			summaryHtml: text(child(item, "description"))
		});
	}

	return items;
}

function parseAtom(doc: Document): FeedItem[] {
	const items: FeedItem[] = [];

	for (const entry of Array.from(doc.getElementsByTagName("entry"))) {
		// Atom date: prefer <published>, fall back to <updated>.
		const published = text(child(entry, "published"));
		const updated = text(child(entry, "updated"));

		// Atom summary: prefer <content>, fall back to <summary>.
		const content = child(entry, "content");
		const summary = child(entry, "summary");

		items.push({
			title: text(child(entry, "title")),
			link: atomLink(entry),
			date: parseFeedDate(published || updated),
			categories: Array.from(entry.getElementsByTagName("category"))
				.map(c => c.getAttribute("term") || "")
				.filter(c => c.length > 0),
			summaryHtml: textContent(content) || textContent(summary)
		});
	}

	return items;
}

/**
 * Resolve an Atom entry link: prefer <link rel="alternate">, else the first
 * <link> with an href.
 */
function atomLink(entry: Element): string {
	const links = Array.from(entry.getElementsByTagName("link"));
	const alternate = links.find(l => l.getAttribute("rel") === "alternate");
	const chosen = alternate ?? links.find(l => l.hasAttribute("href"));
	return chosen?.getAttribute("href")?.trim() ?? "";
}

/** First direct-or-descendant child element with the given local name. */
function child(parent: Element, name: string): Element | null {
	const matches = parent.getElementsByTagName(name);
	return matches.length > 0 ? matches[0] : null;
}

/** Trimmed text of an element, or "" when the element is missing. */
function text(el: Element | null): string {
	return el ? textContent(el) : "";
}

function textContent(el: Element | null): string {
	return el?.textContent?.trim() ?? "";
}

/** Local name without any XML namespace prefix. */
function localName(el: Element): string {
	const name = el.tagName;
	const colon = name.indexOf(":");
	return (colon >= 0 ? name.slice(colon + 1) : name).toLowerCase();
}
