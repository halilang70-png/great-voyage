<script lang="ts">
	import { goto } from '$app/navigation';

	let roomInput = $state('');

	function generateRoom(): string {
		const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let id = '';
		for (let i = 0; i < 6; i++) {
			id += chars[Math.floor(Math.random() * chars.length)];
		}
		return id;
	}

	function joinRoom() {
		const room = roomInput.trim() || generateRoom();
		goto(`/room/${room}`);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') joinRoom();
	}
</script>

<svelte:head>
	<title>clipdrop — P2P clipboard sync</title>
</svelte:head>

<div class="page">
	<main class="container">
		<h1 class="title">clipdrop</h1>
		<p class="subtitle">P2P clipboard sync</p>

		<div class="input-row">
			<input
				type="text"
				class="room-input"
				placeholder="room name, or leave empty for random"
				bind:value={roomInput}
				onkeydown={handleKeydown}
				spellcheck="false"
				autocomplete="off"
			/>
			<button class="nes-btn is-primary" onclick={joinRoom}>&gt;</button>
		</div>
	</main>
</div>

<style>
	.page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 24px;
		padding: 40px 24px;
		max-width: 480px;
		width: 100%;
	}

	.title {
		font-size: 2rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text);
	}

	.subtitle {
		font-size: 0.85rem;
		color: var(--text-dim);
		margin-top: -12px;
	}

	.input-row {
		display: flex;
		gap: 6px;
		width: 100%;
	}

	.room-input {
		flex: 1;
		background: transparent;
		border: 1px solid var(--border);
		padding: 10px 14px;
		color: var(--text);
		font-size: 0.85rem;
		font-family: var(--font-mono);
		outline: none;
	}

	.room-input::placeholder {
		color: var(--text-muted);
		font-family: var(--font);
	}

	.room-input:focus {
		border-color: var(--border-focus);
	}

	.input-row :global(.nes-btn) {
		padding: 10px 18px;
		font-size: 1rem;
		line-height: 1;
	}

	@media (max-width: 480px) {
		.title { font-size: 1.6rem; }
		.input-row { flex-direction: column; }
	}
</style>
