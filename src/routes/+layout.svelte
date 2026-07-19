<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

{@render children()}

<!-- CRT scan-line overlay -->
<div class="crt-overlay"></div>

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
		--accent-glow: rgba(51, 255, 51, 0.4);
		--accent-hover: #66ff66;
		--success: #33ff33;
		--success-glow: rgba(51, 255, 51, 0.4);
		--danger: #ff3333;
		--danger-glow: rgba(255, 51, 51, 0.4);
		--warn: #ffaa33;
		--gradient-1: linear-gradient(135deg, #33ff33 0%, #66ff66 50%, #aaffaa 100%);
		--gradient-2: linear-gradient(135deg, #000000 0%, #0a0a0a 100%);
		--radius: 0;
		--radius-sm: 0;
		--radius-lg: 0;
		--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
		--glow-text: 0 0 4px rgba(51, 255, 51, 0.8), 0 0 8px rgba(51, 255, 51, 0.4), 0 0 12px rgba(51, 255, 51, 0.2);
		--glow-border: 0 0 4px rgba(51, 255, 51, 0.6), 0 0 8px rgba(51, 255, 51, 0.2);
	}

	:global(html) {
		font-family: var(--font);
		background: #000;
		color: var(--text);
		font-size: 16px;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		cursor: auto;
		text-shadow: var(--glow-text);
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
		text-shadow: var(--glow-text);
	}

	:global(a:hover) {
		color: var(--accent-hover);
	}

	:global(button) {
		font-family: inherit;
		cursor: pointer;
		border: none;
		outline: none;
		text-shadow: var(--glow-text);
	}

	:global(input) {
		font-family: inherit;
		border: none;
		outline: none;
		background: transparent;
		text-shadow: var(--glow-text);
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
		box-shadow: var(--glow-border);
	}

	.crt-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		pointer-events: none;
		background:
			repeating-linear-gradient(
				0deg,
				rgba(0, 0, 0, 0.15) 0px,
				rgba(0, 0, 0, 0.15) 1px,
				transparent 1px,
				transparent 3px
			),
			radial-gradient(ellipse at center, transparent 60%, rgba(0, 0, 0, 0.6) 100%);
	}

	:global(.nes-container) {
		background: #000 !important;
		color: var(--text) !important;
		border-image-source: linear-gradient(135deg, #33ff33, #0d5a0d) !important;
		box-shadow: var(--glow-border) !important;
	}
	:global(.nes-container.is-dark) {
		background: #000 !important;
		color: var(--text) !important;
	}
	:global(.nes-btn) {
		background: #000 !important;
		color: var(--text) !important;
		border-image-source: linear-gradient(135deg, #33ff33, #0d5a0d) !important;
		text-shadow: var(--glow-text) !important;
		padding: 8px 14px !important;
		font-size: 0.95rem !important;
		line-height: 1.2 !important;
		border-image-repeat: stretch !important;
	}
	:global(.nes-btn:hover) {
		background: #0a1a0a !important;
		box-shadow: var(--glow-border) !important;
	}
	:global(.nes-btn.is-primary) {
		background: #33ff33 !important;
		color: #000 !important;
		text-shadow: none !important;
		border-image-source: linear-gradient(135deg, #66ff66, #1a8a1a) !important;
		box-shadow: var(--glow-border) !important;
	}
	:global(.nes-btn.is-primary:hover) {
		background: #66ff66 !important;
	}
	:global(.nes-btn.is-small) {
		padding: 6px 10px !important;
		font-size: 0.85rem !important;
	}
</style>
