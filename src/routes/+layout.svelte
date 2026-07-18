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
		--bg-card: #12121a;
		--bg-hover: #1a1a26;
		--border: #2a2a3a;
		--border-focus: #6366f1;
		--text: #e8e8ed;
		--text-dim: #7a7a8e;
		--text-muted: #4a4a5e;
		--accent: #6366f1;
		--accent-glow: rgba(99, 102, 241, 0.3);
		--accent-hover: #818cf8;
		--success: #22c55e;
		--success-glow: rgba(34, 197, 94, 0.25);
		--danger: #ef4444;
		--gradient-1: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%);
		--gradient-2: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
		--radius: 12px;
		--radius-sm: 8px;
		--radius-lg: 16px;
		--font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
		--font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
	}

	:global(html) {
		font-family: var(--font);
		background: var(--bg);
		color: var(--text);
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
	}

	:global(body) {
		min-height: 100dvh;
		overflow-x: hidden;
	}

	:global(a) {
		color: inherit;
		text-decoration: none;
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
	}

	/* Scrollbar */
	:global(::-webkit-scrollbar) {
		width: 6px;
	}
	:global(::-webkit-scrollbar-track) {
		background: transparent;
	}
	:global(::-webkit-scrollbar-thumb) {
		background: var(--border);
		border-radius: 3px;
	}
</style>
