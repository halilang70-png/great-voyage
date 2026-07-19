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
	<div class="hero">
		<div class="brand">
			<div class="brand-icon">⌘</div>
			<h1 class="brand-name">clipdrop</h1>
		</div>
		<p class="brand-desc">peer-to-peer clipboard sync</p>

		<div class="join-box">
			<input
				type="text"
				class="room-input"
				placeholder="enter room name"
				bind:value={roomInput}
				onkeydown={handleKeydown}
				spellcheck="false"
				autocomplete="off"
			/>
			<button class="join-btn" onclick={joinRoom}>
				{roomInput.trim() ? 'join' : 'create'}
			</button>
		</div>
		<p class="join-hint">leave empty to create a new room</p>
	</div>
</div>

<style>
	.page {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
	}

	.hero {
		max-width: 400px;
		width: 100%;
		text-align: center;
	}

	.brand {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		margin-bottom: 6px;
	}

	.brand-icon {
		font-size: 2rem;
		color: var(--success);
	}

	.brand-name {
		font-size: 2rem;
		font-weight: 700;
		color: var(--success);
		letter-spacing: 0.02em;
	}

	.brand-desc {
		color: var(--text-muted);
		font-size: 0.9rem;
		margin-bottom: 40px;
	}

	.join-box {
		display: flex;
		border: 1px solid var(--border);
		background: var(--bg-card);
	}

	.room-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		padding: 14px 16px;
		color: var(--text);
		font-size: 0.95rem;
		font-family: var(--font-mono);
		outline: none;
	}

	.room-input::placeholder {
		color: var(--text-muted);
	}

	.join-btn {
		padding: 14px 24px;
		background: var(--success);
		color: var(--bg);
		border: none;
		font-weight: 700;
		font-size: 0.9rem;
		letter-spacing: 0.05em;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.join-btn:hover {
		opacity: 0.85;
	}

	.join-hint {
		color: var(--text-muted);
		font-size: 0.75rem;
		margin-top: 12px;
	}
</style>
