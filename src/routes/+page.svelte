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
	<div class="cyber-terminal">
		<div class="cyber-terminal__chrome">
			<div class="cyber-terminal__dots">
				<span class="cyber-terminal__dot"></span>
				<span class="cyber-terminal__dot"></span>
				<span class="cyber-terminal__dot"></span>
			</div>
			<span class="cyber-terminal__title">clipdrop</span>
		</div>
		<div class="cyber-terminal__body">
			<div class="cyber-terminal__line">
				<span class="cyber-terminal__prompt">$</span>
				<span class="cyber-text-cyan">clipdrop</span>
				<span class="cyber-text-muted">— P2P clipboard sync</span>
			</div>
			<div class="cyber-terminal__line join-row">
				<span class="cyber-terminal__prompt">$</span>
				<input
					type="text"
					class="cyber-input room-input"
					placeholder="room name, or leave empty for random"
					bind:value={roomInput}
					onkeydown={handleKeydown}
					spellcheck="false"
					autocomplete="off"
				/>
				<button class="cyber-btn" onclick={joinRoom}>ENTER</button>
			</div>
			<div class="cyber-terminal__line">
				<span class="cyber-terminal__prompt">$</span>
				<span class="cyber-terminal__cursor"></span>
			</div>
		</div>
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

	:global(.cyber-terminal) {
		max-width: 520px;
		width: 100%;
	}

	.join-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.room-input {
		flex: 1;
		min-width: 0;
		background: transparent !important;
		border: 1px solid var(--border) !important;
		padding: 8px 12px !important;
		color: var(--text) !important;
		font-size: 0.95rem !important;
		font-family: var(--font-mono) !important;
		outline: none !important;
	}

	.room-input::placeholder {
		color: var(--text-muted);
	}

	.room-input:focus {
		border-color: var(--accent) !important;
	}

	:global(.cyber-btn) {
		white-space: nowrap;
	}
</style>
