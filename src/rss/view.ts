import { ItemView, WorkspaceLeaf, requestUrl, sanitizeHTMLToDom, setIcon } from "obsidian";
import HomepagePlugin from "../main";
import { tr } from "../locale";
import { FeedItem, RssCache, FETCH_TIMEOUT_MS } from "./types";
import { parseFeed } from "./parser";
import { isValidFeedUrl, shouldRefetch, sortAndCap, timeAgo } from "./format";

export const VIEW_TYPE_RSS = "homepage-rss";

/**
 * Custom view that renders a configured RSS/Atom feed as native cards. This is
 * the plugin's first `registerView`/`ItemView`; feed logic (parse, dates,
 * sort, freshness, URL validation) lives in the pure modules under `./`.
 */
export class RSSView extends ItemView {
	plugin: HomepagePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: HomepagePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_RSS;
	}

	getDisplayText(): string {
		return tr("RSS");
	}

	getIcon(): string {
		return "rss";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/** Fetch (subject to the freshness window) or read cache, then render. */
	async render(): Promise<void> {
		const homepage = this.plugin.homepage;
		const data = homepage.data;
		const url = (data.rssUrl || "").trim();

		if (!isValidFeedUrl(url)) {
			this.renderMessage(tr("rssInvalidUrl"), true);
			return;
		}

		// A cache only applies to the currently configured feed URL (A5).
		const cache = data.rssCache;
		const usableCache: RssCache | null = cache !== null && cache.feedUrl === url ? cache : null;
		const now = Date.now();

		if (usableCache !== null && !shouldRefetch(usableCache.fetchedAt, data.rssRefreshMinutes, now)) {
			this.renderItems(usableCache.items, null);
			return;
		}

		try {
			const items = sortAndCap(await this.fetchFeed(url));
			data.rssCache = { fetchedAt: now, feedUrl: url, items };
			await homepage.save();
			this.renderItems(items, null);
		}
		catch (error) {
			// Explicit failure handling (no silent catch): fall back to a valid
			// cache with an indicator, otherwise surface a clear error.
			const message = error instanceof Error ? error.message : String(error);

			if (usableCache !== null && usableCache.items.length > 0) {
				this.renderItems(usableCache.items, usableCache.fetchedAt);
			}
			else {
				this.renderMessage(tr("rssFetchError", message), true);
			}
		}
	}

	/** Fetch the feed via Obsidian's CORS-exempt requestUrl, with a timeout. */
	async fetchFeed(url: string): Promise<FeedItem[]> {
		let timer: number | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = window.setTimeout(
				() => reject(new Error(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`)),
				FETCH_TIMEOUT_MS
			);
		});

		try {
			const response = await Promise.race([
				requestUrl({ url, method: "GET", throw: true }),
				timeout
			]);
			return parseFeed(response.text);
		}
		finally {
			if (timer !== undefined) window.clearTimeout(timer);
		}
	}

	/** Render the item cards, optionally preceded by a "showing cached" banner. */
	renderItems(items: FeedItem[], cachedAt: number | null): void {
		const root = this.contentEl;
		root.empty();
		const container = root.createDiv({ cls: "nv-rss-container" });

		if (cachedAt !== null) {
			container.createDiv({
				cls: "nv-rss-banner mod-warning",
				text: tr("rssShowingCached", timeAgo(cachedAt, Date.now()))
			});
		}

		if (items.length === 0) {
			container.createDiv({ cls: "nv-rss-empty", text: tr("rssNoItems") });
			return;
		}

		const now = Date.now();

		for (const item of items) {
			const card = container.createDiv({ cls: "nv-rss-card" });

			const title = card.createEl("a", {
				cls: "nv-rss-title external-link",
				text: item.title || item.link || tr("rssNoItems"),
				href: item.link || "#"
			});
			title.setAttr("target", "_blank");
			title.setAttr("rel", "noopener");

			const meta = card.createDiv({ cls: "nv-rss-meta" });

			if (item.date !== null) {
				meta.createSpan({ cls: "nv-rss-time", text: timeAgo(item.date, now) });
			}

			for (const category of item.categories) {
				meta.createSpan({ cls: "nv-rss-tag", text: category });
			}

			if (item.summaryHtml) {
				const summary = card.createDiv({ cls: "nv-rss-summary" });
				// Untrusted feed HTML: sanitize at the render boundary (NFR1). Never
				// assign feed content via raw innerHTML.
				summary.append(sanitizeHTMLToDom(item.summaryHtml));
			}
		}
	}

	/** Render a single centered message (error or empty-config state). */
	renderMessage(message: string, isError: boolean): void {
		const root = this.contentEl;
		root.empty();
		const container = root.createDiv({ cls: "nv-rss-container" });
		const box = container.createDiv({
			cls: isError ? "nv-rss-message mod-warning" : "nv-rss-message"
		});
		setIcon(box.createSpan({ cls: "nv-rss-message-icon" }), isError ? "alert-triangle" : "rss");
		box.createSpan({ text: message });
	}
}
