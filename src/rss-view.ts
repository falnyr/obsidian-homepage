import { ItemView, WorkspaceLeaf, requestUrl, setIcon } from "obsidian";
import HomepagePlugin from "./main";
import { Kind, RSS_VIEW_TYPE } from "./homepage";
import { FeedElement, RequestUrlFn, XmlParse, formatDate, formatRelative, loadFeed, sanitizeUrl } from "./rss";
import { tr } from "./locale";

// Adapter wrapping a real DOM Element as the parser's minimal FeedElement.
// Namespace-insensitive: Atom feeds use namespaced elements, so we compare
// lower-cased local names throughout.
class DomFeedElement implements FeedElement {
	constructor(private el: Element) {}

	get localName(): string {
		return this.el.localName.toLowerCase();
	}

	get text(): string {
		return this.el.textContent ?? "";
	}

	attr(name: string): string | null {
		return this.el.getAttribute(name);
	}

	firstChild(localName: string): FeedElement | null {
		const target = localName.toLowerCase();
		for (const child of Array.from(this.el.children)) {
			if (child.localName.toLowerCase() === target) return new DomFeedElement(child);
		}
		return null;
	}

	descendants(localName: string): FeedElement[] {
		const target = localName.toLowerCase();
		const out: FeedElement[] = [];
		const walk = (node: Element): void => {
			for (const child of Array.from(node.children)) {
				if (child.localName.toLowerCase() === target) out.push(new DomFeedElement(child));
				walk(child);
			}
		};
		walk(this.el);
		return out;
	}
}

// Runtime XML parser: browser/Obsidian DOMParser, throwing on a parse error so
// parseFeed's try/catch turns it into a typed error result.
export const domParseXml: XmlParse = (xml) => {
	const doc = new DOMParser().parseFromString(xml, "text/xml");
	if (doc.querySelector("parsererror") || !doc.documentElement) {
		throw new Error("malformed XML");
	}
	return new DomFeedElement(doc.documentElement);
};

// Runtime fetch through Obsidian's CORS-free client (never raw fetch). (C3)
const obsidianRequest: RequestUrlFn = async (url) => {
	const res = await requestUrl({ url, throw: false });
	return { status: res.status, text: res.text };
};

/** The custom leaf that renders an RSS/Atom feed as the homepage. (FR1, FR2, FR6) */
export class RssItemView extends ItemView {
	plugin: HomepagePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: HomepagePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return RSS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return tr(Kind.Rss);
	}

	getIcon(): string {
		return "rss";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async render(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass("nv-rss-view");

		const data = this.plugin.homepage.data;
		const url = data.value;
		const ttl = data.rssRefreshMinutes || 5;

		if (!sanitizeUrl(url)) {
			container.createDiv({ cls: "nv-rss-message mod-warning", text: tr("rssNoUrl") });
			return;
		}

		container.createDiv({ cls: "nv-rss-message", text: tr("rssLoading") });

		const result = await loadFeed(
			url,
			ttl,
			Date.now(),
			this.plugin.rssCache,
			obsidianRequest,
			domParseXml,
		);

		container.empty();

		if (!result.feed) {
			container.createDiv({ cls: "nv-rss-message mod-warning", text: result.error ?? tr("rssError") });
			return;
		}

		const header = container.createDiv({ cls: "nv-rss-header" });
		if (result.feed.feedTitle) {
			header.createEl("h3", { text: result.feed.feedTitle, cls: "nv-rss-feed-title" });
		}
		if (result.stale) {
			header.createDiv({ cls: "nv-rss-stale mod-warning", text: tr("rssStale") });
		}

		if (result.feed.items.length === 0) {
			container.createDiv({ cls: "nv-rss-message", text: tr("rssEmpty") });
			return;
		}

		const list = container.createDiv({ cls: "nv-rss-items" });

		for (const item of result.feed.items) {
			const card = list.createDiv({ cls: "nv-rss-item" });

			const titleRow = card.createDiv({ cls: "nv-rss-title-row" });
			if (item.link) {
				const link = titleRow.createEl("a", {
					text: item.title || item.link,
					cls: "nv-rss-title",
					href: item.link,
				});
				const icon = titleRow.createSpan({ cls: "nv-rss-external-icon" });
				setIcon(icon, "external-link");
				link.addEventListener("click", (e) => {
					e.preventDefault();
					// Open externally; wrapped so a platform without window.open
					// cannot crash the view. (NFR3)
					try {
						window.open(item.link, "_blank");
					} catch {
						// no-op: link is display-only if the platform blocks it
					}
				});
			} else if (item.title) {
				titleRow.createDiv({ text: item.title, cls: "nv-rss-title" });
			}

			const meta = card.createDiv({ cls: "nv-rss-meta" });
			const relative = formatRelative(item.timestamp, Date.now());
			if (relative || item.date) {
				const dateEl = meta.createSpan({ cls: "nv-rss-date", text: relative || item.date });
				// Absolute date+time on hover.
				const absolute = item.timestamp !== null ? formatDate(item.date) : item.date;
				if (absolute) dateEl.setAttribute("title", absolute);
			}
			for (const category of item.categories) {
				meta.createSpan({ cls: "nv-rss-tag", text: category });
			}
			if (!meta.hasChildNodes()) meta.remove();

			if (item.summary) card.createDiv({ text: item.summary, cls: "nv-rss-summary" });
		}
	}
}
