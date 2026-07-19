<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

{@render children()}

<style>
	:global(*) {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	:global(:root) {
		--bg: #0a0a0f;
		--bg-card: #0d0d14;
		--bg-hover: #12121a;
		--border: #00f0ff;
		--border-focus: #00f0ff;
		--text: #b4b4b4;
		--text-dim: #6a6a7a;
		--text-muted: #3a3a4a;
		--accent: #00f0ff;
		--accent-hover: #33f5ff;
		--success: #05ffa1;
		--danger: #ff2a6d;
		--warn: #fcee0a;
		--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
	}

	:global(html) {
		font-family: var(--font);
		background: var(--bg);
		color: var(--text);
		font-size: 16px;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(body) {
		min-height: 100dvh;
		overflow-x: hidden;
		position: relative;
		background: var(--bg);
	}

	:global(a) {
		color: var(--accent);
		text-decoration: none;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	:global(a:hover) {
		color: var(--accent-hover);
		text-decoration: underline;
	}

	:global(button) {
		font-family: inherit;
		cursor: pointer;
	}

	:global(input) {
		font-family: inherit;
		background: transparent;
	}

	:global(::-webkit-scrollbar) {
		width: 6px;
	}
	:global(::-webkit-scrollbar-track) {
		background: var(--bg);
	}
	:global(::-webkit-scrollbar-thumb) {
		background: var(--text-muted);
		border-radius: 3px;
	}
</style>
