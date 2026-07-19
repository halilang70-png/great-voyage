<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import type { WhiteboardMsg } from "./vdo";

	let {
		send,
		onIncoming,
		onClose
	}: {
		send: (msg: WhiteboardMsg) => void;
		onIncoming: (handler: (msg: WhiteboardMsg) => void) => void;
		onClose: () => void;
	} = $props();

	let canvas: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let drawing = false;
	let color = $state("#33ff33");
	let size = $state(3);

	const colors = ["#33ff33", "#ff3333", "#33aaff", "#ffaa33", "#ffffff"];
	const sizes = [2, 4, 8];

	function resize() {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		const snap = document.createElement("canvas");
		snap.width = canvas.width;
		snap.height = canvas.height;
		const sctx = snap.getContext("2d");
		if (sctx && canvas.width > 0) sctx.drawImage(canvas, 0, 0);
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx = canvas.getContext("2d");
		if (ctx) {
			ctx.scale(dpr, dpr);
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			if (snap.width > 0) ctx.drawImage(snap, 0, 0, w, h);
		}
	}

	onMount(() => {
		resize();
		window.addEventListener("resize", resize);
		onIncoming(handleIncoming);
	});
	onDestroy(() => window.removeEventListener("resize", resize));

	function denorm(x: number, y: number): [number, number] {
		return [x * canvas.clientWidth, y * canvas.clientHeight];
	}
	function startStroke(x: number, y: number) {
		if (!ctx) return;
		ctx.strokeStyle = color;
		ctx.lineWidth = size;
		ctx.beginPath();
		const [px, py] = denorm(x, y);
		ctx.moveTo(px, py);
		ctx.lineTo(px + 0.01, py);
		ctx.stroke();
	}
	function extendStroke(x: number, y: number) {
		if (!ctx) return;
		const [px, py] = denorm(x, y);
		ctx.lineTo(px, py);
		ctx.stroke();
	}
	function clearCanvas() {
		if (ctx) ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
	}
	function pointerPos(e: PointerEvent): [number, number] {
		const r = canvas.getBoundingClientRect();
		return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
	}

	function onPointerDown(e: PointerEvent) {
		e.preventDefault();
		canvas.setPointerCapture(e.pointerId);
		drawing = true;
		const [x, y] = pointerPos(e);
		startStroke(x, y);
		send({ kind: "stroke-start", color, size, x, y, ts: Date.now() });
	}
	function onPointerMove(e: PointerEvent) {
		if (!drawing) return;
		const [x, y] = pointerPos(e);
		extendStroke(x, y);
		send({ kind: "stroke-move", x, y, ts: Date.now() });
	}
	function onPointerUp() {
		if (!drawing) return;
		drawing = false;
		send({ kind: "stroke-end", ts: Date.now() });
	}
	function handleClear() {
		clearCanvas();
		send({ kind: "clear", ts: Date.now() });
	}
	function handleIncoming(msg: WhiteboardMsg) {
		if (!ctx) return;
		if (msg.kind === "stroke-start") {
			ctx.strokeStyle = msg.color;
			ctx.lineWidth = msg.size;
			ctx.beginPath();
			const [px, py] = denorm(msg.x, msg.y);
			ctx.moveTo(px, py);
			ctx.lineTo(px + 0.01, py);
			ctx.stroke();
		} else if (msg.kind === "stroke-move") {
			const [px, py] = denorm(msg.x, msg.y);
			ctx.lineTo(px, py);
			ctx.stroke();
		} else if (msg.kind === "clear") {
			clearCanvas();
		}
	}
</script>

<div class="wb-overlay">
	<div class="wb-toolbar">
		<span class="wb-title">// WHITEBOARD</span>
		<div class="wb-tools">
			{#each colors as c}
				<button class="wb-swatch" class:active={color === c} style="background: {c}" onclick={() => (color = c)} aria-label="color"></button>
			{/each}
			<span class="wb-divider"></span>
			{#each sizes as s}
				<button class="wb-size" class:active={size === s} onclick={() => (size = s)} aria-label="brush">{".".repeat(s)}</button>
			{/each}
			<span class="wb-divider"></span>
			<button class="nes-btn is-small" onclick={handleClear} title="清空">C</button>
			<button class="nes-btn is-small" onclick={onClose} title="关闭">x</button>
		</div>
	</div>
	<canvas
		bind:this={canvas}
		class="wb-canvas"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointerleave={onPointerUp}
	></canvas>
</div>

<style>
	.wb-overlay { position: fixed; inset: 0; z-index: 95; background: var(--bg); display: flex; flex-direction: column; }
	.wb-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); background: var(--bg-card); flex-shrink: 0; }
	.wb-title { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-muted); }
	.wb-tools { display: flex; align-items: center; gap: 6px; }
	.wb-swatch { width: 18px; height: 18px; border: 1px solid var(--border); padding: 0; cursor: pointer; }
	.wb-swatch.active { outline: 1px solid var(--text); outline-offset: 1px; }
	.wb-size { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-dim); background: none; border: 1px solid var(--border); padding: 0 6px; cursor: pointer; min-width: 28px; line-height: 1; }
	.wb-size.active { color: var(--text); border-color: var(--text); }
	.wb-divider { width: 1px; height: 16px; background: var(--border); margin: 0 2px; }
	.wb-canvas { flex: 1; width: 100%; touch-action: none; cursor: crosshair; display: block; }
</style>
