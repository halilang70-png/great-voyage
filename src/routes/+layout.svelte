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
		--bg: #0a0a0a;
		--bg-card: #111111;
		--bg-hover: #1a1a1a;
		--border: #33ff33;
		--border-focus: #66ff66;
		--text: #33ff33;
		--text-dim: #1a8a1a;
		--text-muted: #0d5a0d;
		--accent: #33ff33;
		--accent-glow: rgba(51, 255, 51, 0.2);
		--accent-hover: #66ff66;
		--success: #33ff33;
		--success-glow: rgba(51, 255, 51, 0.2);
		--danger: #ff3333;
		--gradient-1: linear-gradient(135deg, #33ff33 0%, #66ff66 50%, #aaffaa 100%);
		--gradient-2: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%);
		--radius: 0;
		--radius-sm: 0;
		--radius-lg: 0;
		--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
	}

	:global(html) {
		font-family: var(--font);
		background: var(--bg);
		color: var(--text);
		font-size: 14px;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		cursor: auto;
	}

	:global(body) {
		min-height: 100dvh;
		overflow-x: hidden;
		position: relative;
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
		width: 8px;
	}
	:global(::-webkit-scrollbar-track) {
		background: var(--bg);
	}
	:global(::-webkit-scrollbar-thumb) {
		background: var(--text-muted);
		border: 1px solid var(--border);
	}

	/* ─── CRT scan-line overlay ─── */
	.crt-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		pointer-events: none;
		background: repeating-linear-gradient(
			0deg,
			rgba(0, 0, 0, 0.08) 0px,
			rgba(0, 0, 0, 0.08) 1px,
			transparent 1px,
			transparent 3px
		);
	}

	/* ─── NES.css tweaks ─── */
	:global(.nes-btn) {
		border-image-repeat: stretch !important;
	}
</style>
