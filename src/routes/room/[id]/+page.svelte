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
		<div class="settings-panel">
			<div class="settings-title">设置</div>
			<label class="toggle-row">
				<span>收到自动复制</span>
				<button class="toggle" class:active={settings.autoCopy} onclick={() => toggleSetting('autoCopy')} aria-label="收到自动复制">
					<span class="toggle-knob"></span>
				</button>
			</label>
			<label class="toggle-row">
				<span>声音提醒</span>
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
		<div class="qr-popup">
			<div class="qr-popup-header">
				<span class="qr-popup-title">扫码加入</span>
				<button class="qr-popup-close" onclick={() => showQR = false}>✕</button>
			</div>
			<QRCode url={roomUrl} />
			<button class="qr-copy-btn" onclick={() => copyToClipboard(roomUrl, -2)}>
				{copiedIndex === -2 ? '✓ 已复制' : '复制链接'}
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
		<button class="back-btn" onclick={goBack} title="back to home">
			<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<line x1="19" y1="12" x2="5" y2="12"/>
				<polyline points="12 19 5 12 12 5"/>
			</svg>
		</button>

		<div class="room-info">
			<div class="room-name">
				<span class="room-label">room</span>
				<span class="room-id">{roomId}</span>
			</div>
			<div class="status">
				<span class="status-dot {statusDot}"></span>
				<span class="status-text">{statusText}</span>
				<button class="mode-toggle" onclick={toggleMode} title={modeToggleLabel}>{modeToggleLabel}</button>
			</div>
		</div>

		<button class="icon-btn" onclick={() => showQR = !showQR} title="QR 码">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<rect x="3" y="3" width="7" height="7" rx="1"/>
				<rect x="14" y="3" width="7" height="7" rx="1"/>
				<rect x="3" y="14" width="7" height="7" rx="1"/>
				<rect x="14" y="14" width="3" height="3"/>
				<line x1="21" y1="14" x2="21" y2="14.01"/>
				<line x1="14" y1="21" x2="14" y2="21.01"/>
				<line x1="21" y1="21" x2="21" y2="21.01"/>
			</svg>
		</button>

		<button class="icon-btn" onclick={() => showSettings = !showSettings} title="设置">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<circle cx="12" cy="12" r="3"/>
				<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
			</svg>
		</button>
	</header>

	<!-- Fallback banner -->
	{#if mode === 'fallback'}
		<div class="fallback-banner">
			<span>KV 模式 · 文字经服务器中转 · 发送后点 <strong>🔄 接收</strong> 同步对方内容</span>
			<button class="fallback-dismiss" onclick={toggleMode}>✕</button>
		</div>
	{/if}

	<!-- History -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="history" onmouseleave={handleLinkLeave}>
		{#if history.length === 0}
			<div class="empty-state">
				<div class="empty-icon">
					<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3">
						<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
						<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
					</svg>
				</div>
				<p>nothing shared yet</p>
				{#if mode === 'fallback'}
					<p class="empty-hint">输入文字发送，点 🔄 接收同步对方内容</p>
				{:else}
					<p class="empty-hint">type text, paste an image, or drop a file</p>
				{/if}
			</div>
		{/if}

		{#each history as item, i (item.timestamp + '-' + i)}
			{@const isOwn = item.senderId === bridge?.['streamId']}
			<div class="msg" class:own={isOwn}>
				<div class="msg-header">
					<span class="msg-type">{item.type === 'text' ? '📝' : '🖼️'}</span>
					<span class="msg-time">{formatTime(item.timestamp)}</span>
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
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round">
									<polyline points="20 6 9 17 4 12"/>
								</svg>
							{:else}
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
									<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
									<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
								</svg>
							{/if}
						</button>
					</div>
				{:else}
					<div class="msg-image">
						<img src={item.content} alt="" />
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<!-- Input -->
	<div class="input-bar">
		<input
			type="text"
			class="msg-input"
			placeholder={mode === 'fallback' ? 'type text to sync...' : 'type a message...'}
			bind:value={inputText}
			onkeydown={handleKeydown}
			disabled={!connected}
		/>
		{#if mode === 'fallback'}
			<button class="action-btn sync-btn" onclick={syncLatest} title="接收" disabled={syncing}>
				{#if syncing}
					<svg class="spin" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
						<line x1="12" y1="2" x2="12" y2="6"/>
						<line x1="12" y1="18" x2="12" y2="22"/>
						<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
						<line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
						<line x1="2" y1="12" x2="6" y2="12"/>
						<line x1="18" y1="12" x2="22" y2="12"/>
						<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
						<line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
					</svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
						<polyline points="23 4 23 10 17 10"/>
						<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
					</svg>
				{/if}
			</button>
		{:else}
			<button class="action-btn paste-btn" onclick={sendImageFromPaste} title="paste image" disabled={!connected}>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
					<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
				</svg>
			</button>
		{/if}
		<button class="action-btn send-btn" onclick={sendText} disabled={!connected || !inputText.trim()} title="send">
			<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<line x1="22" y1="2" x2="11" y2="13"/>
				<polygon points="22 2 15 22 11 13 2 9 22 2"/>
			</svg>
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

	/* Panel overlay */
	.panel-overlay {
		position: fixed; inset: 0; z-index: 90;
		background: rgba(0,0,0,0.4);
	}

	/* Settings panel */
	.settings-panel {
		position: fixed; top: 60px; right: 16px; z-index: 91;
		background: var(--bg-card); border: 1px solid var(--border);
		border-radius: var(--radius); padding: 16px;
		min-width: 200px;
		display: flex; flex-direction: column; gap: 12px;
		animation: slideDown 0.15s ease;
	}
	@keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
	.settings-title { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
	.toggle-row {
		display: flex; align-items: center; justify-content: space-between;
		font-size: 0.85rem; color: var(--text); cursor: pointer;
	}
	.toggle {
		width: 40px; height: 22px; border-radius: 11px;
		background: var(--border); position: relative;
		transition: background 0.2s; cursor: pointer;
	}
	.toggle.active { background: var(--accent); }
	.toggle-knob {
		position: absolute; top: 2px; left: 2px;
		width: 18px; height: 18px; border-radius: 50%;
		background: white; transition: transform 0.2s;
	}
	.toggle.active .toggle-knob { transform: translateX(18px); }

	/* QR popup */
	.qr-popup {
		position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
		z-index: 91; background: var(--bg-card); border: 1px solid var(--border);
		border-radius: var(--radius-lg); padding: 24px;
		display: flex; flex-direction: column; align-items: center; gap: 16px;
		animation: fadeIn 0.15s ease;
	}
	.qr-popup-header { display: flex; align-items: center; width: 100%; justify-content: space-between; }
	.qr-popup-title { font-size: 0.9rem; font-weight: 600; }
	.qr-popup-close {
		width: 28px; height: 28px; border-radius: 6px;
		background: transparent; color: var(--text-muted);
		display: flex; align-items: center; justify-content: center;
		font-size: 0.8rem;
		transition: background 0.15s, color 0.15s;
	}
	.qr-popup-close:hover { background: var(--bg-hover); color: var(--text); }
	.qr-copy-btn {
		padding: 8px 20px; border-radius: var(--radius-sm);
		background: var(--gradient-1); color: white;
		font-size: 0.8rem; font-weight: 600;
		transition: transform 0.1s;
	}
	.qr-copy-btn:active { transform: scale(0.96); }

	/* URL hover preview */
	.url-preview {
		position: fixed; z-index: 80;
		background: var(--bg-card); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 8px 12px;
		max-width: 300px; pointer-events: none;
		display: flex; flex-direction: column; gap: 2px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.3);
		animation: fadeIn 0.1s ease;
	}
	.url-domain { font-size: 0.8rem; font-weight: 600; color: var(--accent); }
	.url-path { font-size: 0.7rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Drop overlay */
	.drop-overlay {
		position: fixed; inset: 0; z-index: 100;
		background: rgba(99, 102, 241, 0.15);
		backdrop-filter: blur(8px);
		display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 12px;
		animation: fadeIn 0.15s ease;
	}
	@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
	.drop-icon { font-size: 3rem; animation: bounce 0.6s ease-in-out infinite alternate; }
	@keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-10px); } }
	.drop-text { font-size: 1.1rem; font-weight: 600; color: var(--accent); }

	/* Header */
	.header {
		display: flex; align-items: center; gap: 8px;
		padding: 10px 12px; border-bottom: 1px solid var(--border);
		background: var(--bg-card); flex-shrink: 0;
	}
	.back-btn, .icon-btn {
		display: flex; align-items: center; justify-content: center;
		width: 36px; height: 36px; border-radius: var(--radius-sm);
		background: transparent; color: var(--text-dim);
		transition: background 0.15s, color 0.15s; flex-shrink: 0;
	}
	.back-btn:hover, .icon-btn:hover { background: var(--bg-hover); color: var(--text); }

	.room-info { flex: 1; min-width: 0; }
	.room-name { display: flex; align-items: center; gap: 6px; }
	.room-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); font-weight: 600; }
	.room-id { font-family: var(--font-mono); font-size: 0.9rem; font-weight: 600; color: var(--text); }
	.status { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
	.status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; }
	.status-dot.connecting { background: #f59e0b; animation: pulse 1.5s ease-in-out infinite; }
	.status-dot.connected { background: var(--success); box-shadow: 0 0 6px var(--success-glow); }
	.status-dot.fallback { background: #f59e0b; animation: pulse 2s ease-in-out infinite; }
	@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
	.status-text { font-size: 0.75rem; color: var(--text-dim); }
	.mode-toggle {
		margin-left: 4px; padding: 2px 8px; border-radius: var(--radius-sm);
		font-size: 0.65rem; font-weight: 600;
		background: rgba(245, 158, 11, 0.12); color: #f59e0b;
		transition: background 0.15s, opacity 0.15s;
		white-space: nowrap;
	}
	.mode-toggle:hover { background: rgba(245, 158, 11, 0.25); }

	/* Fallback banner */
	.fallback-banner {
		padding: 8px 16px;
		background: rgba(245, 158, 11, 0.08);
		border-bottom: 1px solid rgba(245, 158, 11, 0.2);
		font-size: 0.75rem; color: #f59e0b;
		text-align: center; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center; gap: 8px;
	}
	.fallback-dismiss {
		width: 20px; height: 20px; border-radius: 4px;
		display: flex; align-items: center; justify-content: center;
		font-size: 0.7rem; color: #f59e0b; flex-shrink: 0;
		transition: background 0.15s;
	}
	.fallback-dismiss:hover { background: rgba(245, 158, 11, 0.15); }

	/* History */
	.history {
		flex: 1; overflow-y: auto; padding: 16px;
		display: flex; flex-direction: column; gap: 12px;
	}
	.empty-state {
		flex: 1; display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 12px;
		color: var(--text-muted);
	}
	.empty-icon { opacity: 0.5; }
	.empty-state p { font-size: 0.9rem; }
	.empty-hint { font-size: 0.8rem !important; color: var(--text-muted); opacity: 0.6; }

	/* Message */
	.msg {
		background: var(--bg-card); border: 1px solid var(--border);
		border-radius: var(--radius); padding: 12px 16px;
		display: flex; flex-direction: column; gap: 8px;
		max-width: 80%; animation: slideIn 0.2s ease;
	}
	.msg.own { align-self: flex-end; border-color: var(--accent); background: rgba(99, 102, 241, 0.05); }
	@keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

	.msg-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.msg-type { font-size: 0.85rem; }
	.msg-time { font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono); }
	.msg-mode {
		font-size: 0.6rem; padding: 1px 5px; border-radius: 4px;
		background: rgba(99, 102, 241, 0.1); color: var(--accent);
		font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
	}
	.msg-badge {
		font-size: 0.6rem; padding: 1px 5px; border-radius: 4px;
		background: rgba(245, 158, 11, 0.15); color: #f59e0b;
		font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
	}

	.msg-content { display: flex; align-items: flex-start; gap: 8px; }
	.msg-rendered {
		flex: 1; font-family: var(--font-mono); font-size: 0.85rem;
		line-height: 1.6; color: var(--text); overflow-wrap: break-word;
		min-width: 0;
	}
	.msg-rendered :global(p) { margin: 0 0 0.5em; }
	.msg-rendered :global(p:last-child) { margin-bottom: 0; }
	.msg-rendered :global(pre.code-block) {
		background: rgba(0,0,0,0.3); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 12px;
		overflow-x: auto; margin: 0.5em 0; font-size: 0.8rem;
	}
	.msg-rendered :global(.md-inline-code) {
		background: rgba(99, 102, 241, 0.1); padding: 2px 6px;
		border-radius: 4px; font-size: 0.85em; color: var(--accent);
	}
	.msg-rendered :global(.msg-link) {
		color: var(--accent); text-decoration: underline;
		text-decoration-color: rgba(99,102,241,0.3);
		text-underline-offset: 2px;
		transition: text-decoration-color 0.15s;
	}
	.msg-rendered :global(.msg-link:hover) {
		text-decoration-color: var(--accent);
	}
	.msg-rendered :global(.md-link) {
		color: var(--accent); text-decoration: underline;
		text-decoration-color: rgba(99,102,241,0.3); text-underline-offset: 2px;
	}
	.msg-rendered :global(.md-h1) { font-size: 1.2em; font-weight: 700; margin: 0.5em 0 0.3em; }
	.msg-rendered :global(.md-h2) { font-size: 1.1em; font-weight: 700; margin: 0.5em 0 0.3em; }
	.msg-rendered :global(.md-h3) { font-size: 1em; font-weight: 700; margin: 0.5em 0 0.3em; }
	.msg-rendered :global(.md-li) { padding-left: 1.2em; position: relative; }
	.msg-rendered :global(.md-li::before) { content: '·'; position: absolute; left: 0; color: var(--accent); font-weight: 700; }
	.msg-rendered :global(.md-quote) {
		border-left: 3px solid var(--accent); padding-left: 12px;
		margin: 0.5em 0; color: var(--text-dim); font-style: italic;
	}
	.msg-rendered :global(.md-hr) { border: none; border-top: 1px solid var(--border); margin: 0.5em 0; }
	.msg-rendered :global(del) { color: var(--text-muted); }

	/* Syntax highlighting */
	.msg-rendered :global(.hl-keyword) { color: #c792ea; }
	.msg-rendered :global(.hl-string) { color: #c3e88d; }
	.msg-rendered :global(.hl-number) { color: #f78c6c; }
	.msg-rendered :global(.hl-comment) { color: #546e7a; font-style: italic; }
	.msg-rendered :global(.hl-func) { color: #82aaff; }
	.msg-rendered :global(.hl-type) { color: #ffcb6b; }

	.copy-btn {
		flex-shrink: 0; display: flex; align-items: center; justify-content: center;
		width: 28px; height: 28px; border-radius: 6px;
		background: transparent; color: var(--text-muted);
		transition: background 0.15s, color 0.15s;
	}
	.copy-btn:hover { background: var(--bg-hover); color: var(--text); }

	.msg-image img { max-width: 100%; max-height: 300px; border-radius: var(--radius-sm); object-fit: contain; }

	/* Input bar */
	.input-bar {
		display: flex; align-items: center; gap: 8px;
		padding: 12px 16px; border-top: 1px solid var(--border);
		background: var(--bg-card); flex-shrink: 0;
	}
	.msg-input {
		flex: 1; background: var(--bg); border: 1.5px solid var(--border);
		border-radius: var(--radius); padding: 12px 16px;
		color: var(--text); font-size: 0.9rem;
		transition: border-color 0.2s, box-shadow 0.2s;
	}
	.msg-input::placeholder { color: var(--text-muted); }
	.msg-input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--accent-glow); }
	.msg-input:disabled { opacity: 0.5; cursor: not-allowed; }

	.action-btn {
		display: flex; align-items: center; justify-content: center;
		width: 42px; height: 42px; border-radius: var(--radius);
		background: var(--bg-hover); color: var(--text-dim);
		transition: background 0.15s, color 0.15s, transform 0.1s; flex-shrink: 0;
	}
	.action-btn:hover:not(:disabled) { background: var(--border); color: var(--text); }
	.action-btn:active:not(:disabled) { transform: scale(0.95); }
	.action-btn:disabled { opacity: 0.3; cursor: not-allowed; }
	.send-btn { background: var(--gradient-1); color: white; }
	.send-btn:hover:not(:disabled) { filter: brightness(1.1); color: white; }
	.sync-btn { color: var(--accent); }
	.sync-btn:hover:not(:disabled) { background: var(--accent-glow); color: var(--accent); }
	@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
	.spin { animation: spin 0.8s linear infinite; }

	/* Toast notifications */
	.toast-container {
		position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
		z-index: 200; display: flex; flex-direction: column; gap: 8px;
		pointer-events: none; max-width: 400px; width: calc(100% - 32px);
	}
	.toast {
		padding: 10px 16px; border-radius: var(--radius);
		font-size: 0.82rem; font-weight: 500; text-align: center;
		cursor: pointer; pointer-events: auto;
		animation: toastIn 0.2s ease;
		box-shadow: 0 4px 20px rgba(0,0,0,0.4);
		backdrop-filter: blur(12px);
	}
	.toast-info { background: rgba(99, 102, 241, 0.15); border: 1px solid rgba(99, 102, 241, 0.3); color: var(--accent); }
	.toast-success { background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.3); color: #22c55e; }
	.toast-warn { background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); color: #f59e0b; }
	.toast-error { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; }
	@keyframes toastIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
	@keyframes toastOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-8px); } }

	@media (max-width: 480px) {
		.msg { max-width: 90%; }
		.header { gap: 4px; }
	}
</style>
