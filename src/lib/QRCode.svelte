<script lang="ts">
	import { onMount } from 'svelte';

	let { url }: { url: string } = $props();
	let canvas: HTMLCanvasElement;
	let loaded = $state(false);

	onMount(() => {
		drawQR();
	});

	async function drawQR() {
		// Use qrserver.com API — no deps, reliable
		const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&bgcolor=12121a&color=6366f1&data=${encodeURIComponent(url)}`;
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.onload = () => {
			const ctx = canvas.getContext('2d')!;
			// Rounded background
			const r = 12;
			const size = 200;
			ctx.clearRect(0, 0, size, size);
			ctx.fillStyle = '#12121a';
			ctx.beginPath();
			ctx.roundRect(0, 0, size, size, r);
			ctx.fill();
			// QR image
			const pad = 16;
			ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
			loaded = true;
		};
		img.src = qrUrl;
	}
</script>

<div class="qr-wrap" class:loaded>
	<canvas bind:this={canvas} width={200} height={200} class="qr-canvas"></canvas>
	<div class="qr-hint">扫码加入房间</div>
</div>

<style>
	.qr-wrap {
		display: flex; flex-direction: column; align-items: center; gap: 8px;
		opacity: 0; transition: opacity 0.2s;
	}
	.qr-wrap.loaded { opacity: 1; }
	.qr-canvas {
		width: 160px; height: 160px; border-radius: var(--radius);
		border: 1px solid var(--border);
	}
	.qr-hint { font-size: 0.7rem; color: var(--text-muted); }
</style>
