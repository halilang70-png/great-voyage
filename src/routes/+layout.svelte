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
		--bg: #000000;
		--bg-card: #050505;
		--bg-hover: #0a0a0a;
		--border: #33ff33;
		--border-focus: #66ff66;
		--text: #33ff33;
		--text-dim: #1a8a1a;
		--text-muted: #0d5a0d;
		--accent: #33ff33;
		--accent-hover: #66ff66;
		--success: #33ff33;
		--danger: #ff3333;
		--warn: #ffaa33;
		--gradient-1: linear-gradient(135deg, #33ff33 0%, #66ff66 50%, #aaffaa 100%);
		--gradient-2: linear-gradient(135deg, #000000 0%, #0a0a0a 100%);
		--radius: 0;
		--radius-sm: 0;
		--radius-lg: 0;
		--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
	}

	:global(html) {
		font-family: var(--font);
		background: #000;
		color: var(--text);
		font-size: 16px;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		cursor: auto;
	}

	:global(body) {
		min-height: 100dvh;
		overflow-x: hidden;
		position: relative;
		background: #000;
	}

	:global(a) {
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	:global(a:hover) {
		color: var(--accent-hover);
	}

	:global(button) {
		font-family: inherit;
		cursor: pointer;
		border: none;
		outline: none;
	}

	:global(input) {
		font-family: inherit;
		border: none;
		outline: none;
		background: transparent;
	}

	:global(::-webkit-scrollbar) {
		width: 10px;
	}
	:global(::-webkit-scrollbar-track) {
		background: #000;
	}
	:global(::-webkit-scrollbar-thumb) {
		background: var(--text-muted);
		border: 1px solid var(--border);
	}

	:global(.nes-container) {
		background: #000 !important;
		color: var(--text) !important;
		border-image-source: linear-gradient(135deg, #33ff33, #0d5a0d) !important;
	}
	:global(.nes-container.is-dark) {
		background: #000 !important;
		color: var(--text) !important;
	}
	:global(.nes-btn) {
		background: #000 !important;
		color: var(--text) !important;
		border-image-source: linear-gradient(135deg, #33ff33, #0d5a0d) !important;
		padding: 8px 14px !important;
		font-size: 0.95rem !important;
		line-height: 1.2 !important;
		border-image-repeat: stretch !important;
	}
	:global(.nes-btn:hover) {
		background: #0a1a0a !important;
	}
	:global(.nes-btn.is-primary) {
		background: #33ff33 !important;
		color: #000 !important;
		border-image-source: linear-gradient(135deg, #66ff66, #1a8a1a) !important;
	}
	:global(.nes-btn.is-primary:hover) {
		background: #66ff66 !important;
	}
	:global(.nes-btn.is-small) {
		padding: 6px 10px !important;
		font-size: 0.85rem !important;
	}
</style>
