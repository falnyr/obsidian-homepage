import { defineConfig } from "vitest/config";

// Headless unit tests for the pure RSS logic (src/rss/parser.ts, format.ts).
// jsdom provides DOMParser for feed parsing. The existing in-Obsidian test
// harness (npm test) is separate and unaffected.
export default defineConfig({
	test: {
		environment: "jsdom",
		include: ["tests/unit/**/*.test.ts"]
	}
});
