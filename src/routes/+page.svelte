<script lang="ts">
	import { goto } from '$app/navigation';

	let roomInput = $state('');
	let copied = $state(false);

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
	<!-- Background grid -->
	<div class="bg-grid"></div>
	<div class="bg-glow"></div>

	<main class="container">
		<!-- Logo -->
		<div class="logo-area">
			<div class="logo-icon">
				<svg width="48" height="48" viewBox="0 0 48 48" fill="none">
					<rect x="8" y="4" width="32" height="40" rx="4" stroke="currentColor" stroke-width="2.5" fill="none"/>
					<rect x="16" y="0" width="16" height="8" rx="3" fill="currentColor" opacity="0.8"/>
					<line x1="16" y1="18" x2="32" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
					<line x1="16" y1="24" x2="28" y2="24" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
					<line x1="16" y1="30" x2="30" y2="30" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
				</svg>
			</div>
			<h1 class="logo-text">clip<span class="accent">drop</span></h1>
			<p class="tagline">P2P clipboard sync between devices</p>
		</div>

		<!-- Card -->
		<div class="card">
			<div class="card-label">create or join a room</div>
			<div class="input-row">
				<input
					type="text"
					class="room-input"
					placeholder="room name (or leave empty to generate)"
					bind:value={roomInput}
					onkeydown={handleKeydown}
					spellcheck="false"
					autocomplete="off"
				/>
				<button class="btn-primary" onclick={joinRoom}>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
						<line x1="5" y1="12" x2="19" y2="12"/>
						<polyline points="12 5 19 12 12 19"/>
					</svg>
					<span>go</span>
				</button>
			</div>
		</div>

		<!-- Features -->
		<div class="features">
			<div class="feature">
				<div class="feature-icon">⚡</div>
				<div class="feature-text">
					<strong>instant</strong>
					<span>peer-to-peer, zero server lag</span>
				</div>
			</div>
			<div class="feature">
				<div class="feature-icon">🔒</div>
				<div class="feature-text">
					<strong>private</strong>
					<span>end-to-end encrypted, no storage</span>
				</div>
			</div>
			<div class="feature">
				<div class="feature-icon">💸</div>
				<div class="feature-text">
					<strong>free</strong>
					<span>no accounts, no limits, no tracking</span>
				</div>
			</div>
		</div>

		<!-- Footer -->
		<div class="footer">
			<span>built with <a href="https://svelte.dev" target="_blank">SvelteKit</a> + <a href="https://vdo.ninja" target="_blank">VDO.Ninja SDK</a></span>
		</div>
	</main>
</div>

<style>
	.page {
		position: relative;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.bg-grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(rgba(99, 102, 241, 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px);
		background-size: 60px 60px;
		mask-image: radial-gradient(ellipse 60% 60% at 50% 50%, black 20%, transparent 70%);
		-webkit-mask-image: radial-gradient(ellipse 60% 60% at 50% 50%, black 20%, transparent 70%);
	}

	.bg-glow {
		position: absolute;
		top: -20%;
		left: 50%;
		transform: translateX(-50%);
		width: 600px;
		height: 600px;
		background: radial-gradient(circle, rgba(99, 102, 241, 0.08) 0%, transparent 70%);
		pointer-events: none;
	}

	.container {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 40px;
		padding: 40px 24px;
		max-width: 520px;
		width: 100%;
	}

	/* Logo */
	.logo-area {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}

	.logo-icon {
		color: var(--accent);
		filter: drop-shadow(0 0 20px var(--accent-glow));
		animation: float 6s ease-in-out infinite;
	}

	@keyframes float {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-6px); }
	}

	.logo-text {
		font-size: 2.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
	}

	.accent {
		background: var(--gradient-1);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.tagline {
		color: var(--text-dim);
		font-size: 0.95rem;
		letter-spacing: 0.02em;
	}

	/* Card */
	.card {
		width: 100%;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.card-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
	}

	.input-row {
		display: flex;
		gap: 8px;
	}

	.room-input {
		flex: 1;
		background: var(--bg);
		border: 1.5px solid var(--border);
		border-radius: var(--radius);
		padding: 14px 16px;
		color: var(--text);
		font-size: 0.95rem;
		font-family: var(--font-mono);
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.room-input::placeholder {
		color: var(--text-muted);
		font-family: var(--font);
	}

	.room-input:focus {
		border-color: var(--border-focus);
		box-shadow: 0 0 0 3px var(--accent-glow);
	}

	.btn-primary {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 14px 24px;
		background: var(--gradient-1);
		color: white;
		font-weight: 600;
		font-size: 0.9rem;
		border-radius: var(--radius);
		transition: transform 0.15s, box-shadow 0.15s;
		white-space: nowrap;
	}

	.btn-primary:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 20px var(--accent-glow);
	}

	.btn-primary:active {
		transform: translateY(0) scale(0.98);
	}

	/* Features */
	.features {
		display: flex;
		flex-direction: column;
		gap: 16px;
		width: 100%;
	}

	.feature {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 18px;
		background: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		transition: border-color 0.2s;
	}

	.feature:hover {
		border-color: var(--border-focus);
	}

	.feature-icon {
		font-size: 1.3rem;
		flex-shrink: 0;
	}

	.feature-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.feature-text strong {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.feature-text span {
		font-size: 0.8rem;
		color: var(--text-dim);
	}

	/* Footer */
	.footer {
		color: var(--text-muted);
		font-size: 0.75rem;
	}

	.footer a {
		color: var(--accent);
		transition: color 0.2s;
	}

	.footer a:hover {
		color: var(--accent-hover);
	}

	@media (max-width: 480px) {
		.logo-text {
			font-size: 2rem;
		}
		.input-row {
			flex-direction: column;
		}
		.btn-primary {
			justify-content: center;
		}
	}
</style>
