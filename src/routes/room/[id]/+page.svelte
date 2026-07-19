<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { ClipboardBridge, type ClipboardPayload, type PeerInfo, type ConnectionMode } from '$lib/vdo';
	import { playReceive, playSend } from '$lib/sound';
	import { getSettings, saveSettings, loadHistory, saveHistory, type Settings } from '$lib/storage';
	import { renderContent, detectMode } from '$lib/renderer';
	import { compressImage } from '$lib/image';
	import QRCode from '$lib/QRCode.svelte';

	const roomId = $derived($page.params.id ?? 'unknown');

	let bridge: ClipboardBridge | null = $state(null);
	let connected = $state(false);
	let peers = $state<PeerInfo[]>([]);
	let mode = $state<ConnectionMode>('connecting');
	let history = $state<ClipboardPayload[]>([]);
	let inputText = $state('');
	let dragOver = $state(false);
	let copiedIndex = $state<number | null>(null);
	let syncing = $state(false);
	let settings = $state<Settings>(getSettings());
	let showQR = $state(false);
	let showSettings = $state(false);
	let hoverUrl = $state<string | null>(null);
	let hoverPos = $state({ x: 0, y: 0 });

	type Toast = { id: number; text: string; type: 'info' | 'warn' | 'error' | 'success' };
	let toasts = $state<Toast[]>([]);
	let _toastId = 0;
	function pushToast(text: string, type: Toast['type'] = 'info', ms = 4000) {
		const id = ++_toastId;
		toasts = [...toasts, { id, text, type }];
		if (ms > 0) {
			setTimeout(() => { toasts = toasts.filter(t => t.id !== id); }, ms);
		}
	}
	let prevMode = $state<ConnectionMode>('connecting');

	let roomUrl = $derived(typeof window !== 'undefined' ? window.location.href : '');

	let statusText = $derived.by(() => {
		if (mode === 'connecting') return 'waiting for peer…';
		if (mode === 'fallback') return 'KV 模式';
		if (peers.length > 0) return `${peers.length} peer${peers.length > 1 ? 's' : ''} · P2P`;
		return 'P2P ready';
	});

	let modeToggleLabel = $derived(mode === 'fallback' ? '切回 P2P' : '切换 KV');

	let statusDot = $derived.by(() => {
		if (mode === 'connecting') return 'connecting';
		if (mode === 'fallback') return 'fallback';
		return 'connected';
	});

	function showToast(idx: number) {
		copiedIndex = idx;
		setTimeout(() => { copiedIndex = null; }, 1500);
	}

	async function copyToClipboard(text: string, idx: number) {
		try {
			await navigator.clipboard.writeText(text);
			showToast(idx);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			showToast(idx);
		}
	}

	function handleClipboardPayload(payload: ClipboardPayload) {
		if (history.some(h => h.timestamp === payload.timestamp && h.content === payload.content)) return;
		history = [payload, ...history].slice(0, 50);
		if (payload.senderId !== bridge?.['streamId']) {
			playReceive();
		}
		if (settings.autoCopy && payload.type === 'text') {
			navigator.clipboard.writeText(payload.content).catch(() => {});
		}
	}

	function handlePeersChange(p: PeerInfo[]) {
		peers = p;
	}

	function handleConnectionChange(c: boolean) {
		connected = c;
	}

	function handleModeChange(m: ConnectionMode) {
		const prev = prevMode;
		mode = m;
		prevMode = m;
		if (m === 'p2p' || m === 'fallback') connected = true;

		if (prev === 'connecting' && m === 'p2p') {
			pushToast('✅ P2P 已连接', 'success', 3000);
		} else if (prev === 'p2p' && m === 'connecting') {
			pushToast('⚡ P2P 断开，尝试重连中…', 'warn', 5000);
		}
	}

	function toggleSetting(key: keyof Settings) {
		settings[key] = !settings[key];
		saveSettings(settings);
	}

	function toggleMode() {
		if (!bridge) return;
		if (mode === 'fallback') {
			bridge.forceP2P();
			pushToast('🔄 已切换回 P2P 模式', 'info', 3000);
		} else {
			bridge.forceFallback();
			pushToast('🔄 已切换到 KV 模式（仅文字）', 'info', 3000);
		}
	}

	async function sendText() {
		if (!inputText.trim() || !bridge) return;
		const text = inputText.trim();
		inputText = '';
		const ok = await bridge.sendText(text);
		if (ok) {
			playSend();
		} else if (mode === 'fallback') {
			pushToast('❌ KV 发送失败', 'error', 4000);
		} else {
			pushToast('❌ P2P 发送重试失败，可尝试切换 KV 模式', 'error', 5000);
		}
	}

	async function syncLatest() {
		if (!bridge || syncing) return;
		syncing = true;
		await bridge.fetchLatest();
		syncing = false;
	}

	async function sendImageFromPaste() {
		if (mode !== 'p2p') {
			pushToast('❌ 图片粘贴需要 P2P 连接', 'error', 4000);
			return;
		}
		try {
			const items = await navigator.clipboard.read();
			for (const item of items) {
				for (const type of item.types) {
					if (type.startsWith('image/')) {
						const blob = await item.getType(type);
						try {
							const dataUrl = await compressImage(blob);
							const rawBytes = Math.round((dataUrl.length - 22) * 0.75);
							if (rawBytes > 250_000) {
								pushToast(`❌ 图片太大（${Math.round(rawBytes / 1024)}KB > 250KB）`, 'error', 5000);
								return;
							}
							const ok = await bridge?.sendImage(dataUrl);
							if (ok) {
								pushToast('🖼️ 图片已发送', 'success', 2000);
							} else {
								pushToast('❌ P2P 图片发送失败，可尝试切换 KV 模式', 'error', 5000);
							}
						} catch (err) {
							console.error('[clipdrop] image compress failed:', err);
							pushToast('❌ 图片处理失败', 'error', 4000);
						}
						return;
					}
				}
			}
		} catch (e) {
			console.warn('Clipboard read failed:', e);
		}
	}

	function handleFileDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (mode !== 'p2p') {
			pushToast('❌ 图片拖拽发送需要 P2P 连接', 'error', 4000);
			return;
		}
		const file = e.dataTransfer?.files[0];
		if (!file || !file.type.startsWith('image/')) return;
		compressImage(file).then(async (dataUrl) => {
			const rawBytes = Math.round((dataUrl.length - 22) * 0.75);
			if (rawBytes > 250_000) {
				pushToast(`❌ 图片太大（${Math.round(rawBytes / 1024)}KB > 250KB）`, 'error', 5000);
				return;
			}
			const ok = await bridge?.sendImage(dataUrl);
			if (ok) {
				pushToast('🖼️ 图片已发送', 'success', 2000);
			} else {
				pushToast('❌ P2P 图片发送失败，可尝试切换 KV 模式', 'error', 5000);
			}
		}).catch(err => {
			console.error('[clipdrop] image compress failed:', err);
			pushToast('❌ 图片处理失败', 'error', 4000);
		});
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendText();
		}
	}

	function goBack() {
		bridge?.destroy();
		goto('/');
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function handleLinkHover(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (target.classList.contains('msg-link')) {
			hoverUrl = target.getAttribute('href');
			hoverPos = { x: e.clientX, y: e.clientY };
		}
	}

	function handleLinkLeave() {
		hoverUrl = null;
	}

	function parseUrlDisplay(url: string): { domain: string; path: string } {
		try {
			const u = new URL(url);
			return { domain: u.hostname, path: u.pathname + u.search };
		} catch {
			return { domain: url, path: '' };
		}
	}

	function preventFileDefault(e: DragEvent) {
		if (e.dataTransfer?.types.includes('Files')) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	// Persist history on change
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => saveHistory(roomId, history), 300);
	}

	// Watch history changes
	$effect(() => {
		history; // track
		scheduleSave();
	});

	onMount(async () => {
		// Restore history
		history = loadHistory(roomId);

		bridge = new ClipboardBridge(roomId);
		bridge.onClipboard(handleClipboardPayload);
		bridge.onPeersChange(handlePeersChange);
		bridge.onConnectionChange(handleConnectionChange);
		bridge.onModeChange(handleModeChange);

		try {
			await bridge.init();
		} catch (e) {
			console.error(e);
		}

		// Prevent browser from opening dragged files (images, etc.)
		window.addEventListener('dragover', preventFileDefault);
		window.addEventListener('drop', preventFileDefault);
	});

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
		bridge?.destroy();
		window.removeEventListener('dragover', preventFileDefault);
		window.removeEventListener('drop', preventFileDefault);
	});
</script>

<svelte:head>
	<title>clipdrop — room {roomId}</title>
</svelte:head>

<div
	class="room-page"
	role="application"
	ondrop={handleFileDrop}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
>
	{#if dragOver}
		<div class="drop-overlay">
			<div class="drop-icon">📎</div>
			<div class="drop-text">drop image to send</div>
		</div>
	{/if}

	<!-- Settings panel -->
	{#if showSettings}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="panel-overlay" onclick={() => showSettings = false}></div>
		<div class="nes-container is-dark settings-panel">
			<div class="settings-title">// SETTINGS</div>
			<label class="toggle-row">
				<span>auto_copy</span>
				<button class="toggle" class:active={settings.autoCopy} onclick={() => toggleSetting('autoCopy')} aria-label="收到自动复制">
					<span class="toggle-knob"></span>
				</button>
			</label>
			<label class="toggle-row">
				<span>sound</span>
				<button class="toggle" class:active={settings.soundEnabled} onclick={() => toggleSetting('soundEnabled')} aria-label="声音提醒">
					<span class="toggle-knob"></span>
				</button>
			</label>
		</div>
	{/if}

	<!-- QR popup -->
	{#if showQR}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="panel-overlay" onclick={() => showQR = false}></div>
		<div class="nes-container is-dark qr-popup">
			<div class="qr-popup-header">
				<span class="qr-popup-title">// SCAN</span>
				<button class="nes-btn is-small" onclick={() => showQR = false}>✕</button>
			</div>
			<QRCode url={roomUrl} />
			<button class="nes-btn qr-copy-btn" onclick={() => copyToClipboard(roomUrl, -2)}>
				{copiedIndex === -2 ? '✓ copied' : 'copy link'}
			</button>
		</div>
	{/if}

	<!-- URL hover preview -->
	{#if hoverUrl}
		{@const display = parseUrlDisplay(hoverUrl)}
		<div class="url-preview" style="left: {Math.min(hoverPos.x, window.innerWidth - 320)}px; top: {hoverPos.y - 56}px">
			<span class="url-domain">{display.domain}</span>
			<span class="url-path">{display.path}</span>
		</div>
	{/if}

	<!-- Header -->
	<header class="header">
		<button class="nes-btn is-small" onclick={goBack} title="back to home">{'<'}</button>

		<div class="room-info">
			<div class="status">
				<span class="status-dot {statusDot}"></span>
				<span class="status-text">[{statusText}]</span>
				<span class="status-room">{roomId}</span>
				<button class="nes-btn is-small mode-toggle" onclick={toggleMode} title={modeToggleLabel}>{modeToggleLabel}</button>
			</div>
		</div>

		<button class="nes-btn is-small" onclick={() => showQR = !showQR} title="QR 码">QR</button>

		<button class="nes-btn is-small" onclick={() => showSettings = !showSettings} title="设置">⚙</button>
	</header>

	<!-- Fallback banner -->
	{#if mode === 'fallback'}
		<div class="fallback-banner">
			<span>> KV mode — server relay</span>
			<button class="nes-btn is-small" onclick={toggleMode}>switch to P2P</button>
		</div>
	{/if}

	<!-- History -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="history" onmouseleave={handleLinkLeave}>
		{#if history.length === 0}
			<div class="empty-state">
				<p class="empty-prompt">[clipdrop] <span class="blink">▌</span></p>
				<p class="empty-hint">type a message, paste an image, or drop a file</p>
			</div>
		{/if}

		{#each history as item, i (item.timestamp + '-' + i)}
			{@const isOwn = item.senderId === bridge?.['streamId']}
			<div class="msg" class:own={isOwn}>
				<div class="msg-prefix">{isOwn ? '$' : '>'}</div>
				<div class="msg-body">
					<div class="msg-meta">
						<span class="msg-time">[{formatTime(item.timestamp)}]</span>
						{#if item.type === 'text'}
							<span class="msg-mode">{detectMode(item.content)}</span>
						{/if}
						{#if item.senderId === 'fallback'}
							<span class="msg-badge">synced</span>
						{/if}
					</div>
					{#if item.type === 'text'}
						<div class="msg-content">
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<!-- svelte-ignore a11y_mouse_events_have_key_events -->
							<div class="msg-rendered" onmouseover={handleLinkHover}>
								{@html renderContent(item.content)}
							</div>
							<button class="copy-btn" onclick={() => copyToClipboard(item.content, i)} title="copy to clipboard">
								{#if copiedIndex === i}
									✓
								{:else}
									[copy]
								{/if}
							</button>
						</div>
					{:else}
						<div class="msg-image">
							<img src={item.content} alt="" />
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Input -->
	<div class="input-bar">
		<span class="input-prompt">{mode === 'fallback' ? 'KV>' : '$'}</span>
		<input
			type="text"
			class="msg-input"
			placeholder="type a message..."
			bind:value={inputText}
			onkeydown={handleKeydown}
			disabled={!connected}
		/>
		{#if mode === 'fallback'}
			<button class="nes-btn" onclick={syncLatest} title="接收" disabled={syncing}>
				{syncing ? '⟳' : '↻'}
			</button>
		{:else}
			<button class="nes-btn" onclick={sendImageFromPaste} title="paste image" disabled={!connected}>
				P
			</button>
		{/if}
		<button class="nes-btn is-primary" onclick={sendText} disabled={!connected || !inputText.trim()} title="send">
			&gt;
		</button>
	</div>

	<!-- Toast notifications -->
	{#if toasts.length > 0}
		<div class="toast-container">
			{#each toasts as toast (toast.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="toast toast-{toast.type}" onclick={() => toasts = toasts.filter(t => t.id !== toast.id)}>
					{toast.text}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.room-page {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		position: relative;
	}

	/* ─── Panel overlay ─── */
	.panel-overlay {
		position: fixed; inset: 0; z-index: 90;
		background: rgba(0,0,0,0.6);
	}

	/* ─── Settings panel ─── */
	.settings-panel {
		position: fixed; top: 56px; right: 8px; z-index: 91;
		min-width: 200px;
		animation: fadeIn 0.15s ease;
		font-size: 0.75rem;
	}
	.settings-title {
		font-size: 0.65rem; font-weight: 700;
		letter-spacing: 0.15em; color: var(--text-muted);
		margin-bottom: 8px;
	}
	.toggle-row {
		display: flex; align-items: center; justify-content: space-between;
		font-size: 0.75rem; color: var(--text); cursor: pointer;
		padding: 4px 0;
	}
	.toggle {
		width: 36px; height: 18px;
		border: 1px solid var(--border); position: relative;
		transition: background 0.2s; cursor: pointer;
		background: var(--bg);
	}
	.toggle.active { background: var(--accent); }
	.toggle-knob {
		position: absolute; top: 1px; left: 1px;
		width: 14px; height: 14px;
		background: var(--text); transition: transform 0.2s;
	}
	.toggle.active .toggle-knob { transform: translateX(18px); }

	/* ─── QR popup ─── */
	.qr-popup {
		position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
		z-index: 91;
		display: flex; flex-direction: column; align-items: center; gap: 16px;
		animation: fadeIn 0.15s ease;
		font-size: 0.75rem;
	}
	.qr-popup-header { display: flex; align-items: center; width: 100%; justify-content: space-between; }
	.qr-popup-title { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); }

	/* ─── Drop overlay ─── */
	.drop-overlay {
		position: fixed; inset: 0; z-index: 100;
		background: rgba(51, 255, 51, 0.08);
		border: 2px dashed var(--border);
		display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 12px;
		animation: fadeIn 0.15s ease;
	}
	.drop-text { font-size: 1rem; font-weight: 400; color: var(--text); }

	/* ─── Animations ─── */
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
	@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

	/* ─── Header ─── */
	.header {
		display: flex; align-items: center; gap: 8px;
		padding: 8px 8px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-card); flex-shrink: 0;
	}
	.header :global(.nes-btn) {
		padding: 2px 8px;
		font-size: 0.7rem;
		line-height: 1;
	}
	.room-info { flex: 1; min-width: 0; }
	.status {
		display: flex; align-items: center; gap: 6px;
		font-size: 0.75rem;
	}
	.status-dot { width: 6px; height: 6px; background: var(--text-muted); flex-shrink: 0; }
	.status-dot.connecting { background: #f5a623; animation: blink 1s step-end infinite; }
	.status-dot.connected { background: var(--success); }
	.status-dot.fallback { background: #f5a623; }
	.status-text { color: var(--text); }
	.status-room { 
		color: var(--text-dim); margin-left: 4px;
		font-family: var(--font-mono); font-size: 0.7rem;
	}

	/* ─── Fallback banner ─── */
	.fallback-banner {
		padding: 6px 12px;
		border-bottom: 1px solid var(--border);
		font-size: 0.7rem; color: var(--text-dim);
		display: flex; align-items: center; justify-content: space-between; gap: 8px;
		flex-shrink: 0;
	}
	.fallback-banner :global(.nes-btn) {
		font-size: 0.6rem; padding: 1px 6px;
	}

	/* ─── History ─── */
	.history {
		flex: 1; overflow-y: auto; padding: 12px 8px;
		display: flex; flex-direction: column; gap: 4px;
	}

	/* ─── Empty state ─── */
	.empty-state {
		flex: 1; display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 8px;
	}
	.empty-prompt { font-size: 0.9rem; color: var(--text-dim); }
	.empty-hint { font-size: 0.7rem; color: var(--text-muted); }

	/* ─── Message ─── */
	.msg {
		display: flex; gap: 6px;
		font-size: 0.8rem;
		line-height: 1.5;
		padding: 2px 0;
	}
	.msg-prefix {
		flex-shrink: 0;
		color: var(--text-dim);
		font-weight: 700;
		width: 12px;
		text-align: right;
		user-select: none;
	}
	.msg-body {
		flex: 1; min-width: 0;
	}
	.msg-meta {
		display: flex; align-items: center; gap: 6px;
		font-size: 0.6rem;
		margin-bottom: 1px;
	}
	.msg-time { color: var(--text-muted); }
	.msg-mode {
		color: var(--text-dim);
	}
	.msg-badge {
		color: #f5a623;
	}

	.msg-content { display: flex; align-items: flex-start; gap: 6px; }
	.msg-rendered {
		flex: 1;
		overflow-wrap: break-word;
		min-width: 0;
	}
	.msg-rendered :global(p) { margin: 0 0 0.3em; }
	.msg-rendered :global(p:last-child) { margin-bottom: 0; }
	.msg-rendered :global(pre.code-block) {
		background: var(--bg); border: 1px solid var(--border);
		padding: 8px; overflow-x: auto; margin: 0.3em 0;
		font-size: 0.75rem;
	}
	.msg-rendered :global(.md-inline-code) {
		background: var(--bg); border: 1px solid var(--border);
		padding: 1px 5px; font-size: 0.85em;
	}
	.msg-rendered :global(.msg-link) {
		color: var(--accent); text-decoration: underline;
		text-underline-offset: 2px;
	}
	.msg-rendered :global(.md-link) {
		color: var(--accent); text-decoration: underline;
		text-underline-offset: 2px;
	}
	.msg-rendered :global(.md-h1) { font-size: 1.1em; font-weight: 700; margin: 0.3em 0 0.2em; }
	.msg-rendered :global(.md-h2) { font-size: 1em; font-weight: 700; margin: 0.3em 0 0.2em; }
	.msg-rendered :global(.md-h3) { font-size: 0.95em; font-weight: 700; margin: 0.3em 0 0.2em; }
	.msg-rendered :global(.md-li) { padding-left: 1.2em; position: relative; }
	.msg-rendered :global(.md-li::before) { content: '·'; position: absolute; left: 0; color: var(--accent); }
	.msg-rendered :global(.md-quote) {
		border-left: 2px solid var(--accent); padding-left: 8px;
		margin: 0.3em 0; color: var(--text-dim);
	}
	.msg-rendered :global(.md-hr) { border: none; border-top: 1px solid var(--border); margin: 0.3em 0; }
	.msg-rendered :global(del) { color: var(--text-muted); }

	/* Syntax highlighting */
	.msg-rendered :global(.hl-keyword) { color: #f5a623; }
	.msg-rendered :global(.hl-string) { color: #33ff33; }
	.msg-rendered :global(.hl-number) { color: #f5a623; }
	.msg-rendered :global(.hl-comment) { color: var(--text-muted); font-style: italic; }
	.msg-rendered :global(.hl-func) { color: var(--accent); }
	.msg-rendered :global(.hl-type) { color: #f5a623; }

	.copy-btn {
		flex-shrink: 0;
		font-family: inherit; font-size: 0.6rem;
		color: var(--text-muted); background: none;
		border: none; cursor: pointer; padding: 0 2px;
	}
	.copy-btn:hover { color: var(--text); }

	.msg-image img { max-width: 100%; max-height: 240px; border: 1px solid var(--border); object-fit: contain; }

	/* ─── Input bar ─── */
	.input-bar {
		display: flex; align-items: center; gap: 6px;
		padding: 8px;
		border-top: 1px solid var(--border);
		background: var(--bg-card); flex-shrink: 0;
	}
	.input-prompt {
		flex-shrink: 0;
		color: var(--text-dim);
		font-weight: 700;
		font-size: 0.85rem;
		user-select: none;
	}
	.msg-input {
		flex: 1;
		background: transparent; border: none;
		padding: 6px 0;
		color: var(--text); font-size: 0.8rem;
		font-family: var(--font-mono);
		outline: none;
	}
	.msg-input::placeholder { color: var(--text-muted); }
	.msg-input:disabled { opacity: 0.4; }
	.msg-input:focus {
		caret-color: var(--text);
	}

	.input-bar :global(.nes-btn) {
		padding: 4px 10px;
		font-size: 0.75rem;
		line-height: 1;
	}

	/* ─── Toast notifications ─── */
	.toast-container {
		position: fixed; bottom: 60px; left: 50%; transform: translateX(-50%);
		z-index: 200; display: flex; flex-direction: column; gap: 4px;
		pointer-events: none; max-width: 400px; width: calc(100% - 32px);
	}
	.toast {
		padding: 6px 12px;
		font-size: 0.7rem; text-align: center;
		cursor: pointer; pointer-events: auto;
		animation: fadeIn 0.15s ease;
		border: 1px solid var(--border);
		background: var(--bg-card);
		color: var(--text);
	}
	.toast-success { border-color: var(--success); color: var(--success); }
	.toast-error { border-color: var(--danger); color: var(--danger); }
	.toast-warn { border-color: #f5a623; color: #f5a623; }
	.toast-info { border-color: var(--text-dim); color: var(--text-dim); }

	/* ─── Blink cursor ─── */
	.blink { animation: blink 1s step-end infinite; }

	/* ─── Responsive ─── */
	@media (max-width: 480px) {
		.header { gap: 4px; }
		.header :global(.nes-btn) { font-size: 0.6rem; padding: 1px 6px; }
	}
</style>
