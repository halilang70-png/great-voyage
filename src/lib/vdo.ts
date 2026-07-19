/**
 * ClipboardBridge — P2P primary, HTTP fallback.
 *
 * Architecture:
 *   1. Try P2P via VDO.Ninja SDK (DataChannel)
 *   2. No auto-timeout — P2P can take as long as it needs
 *   3. If user sends before P2P connects → fall back to HTTP pull via /api/sync
 *   4. Receiver manually triggers fetch instead of polling
 *   5. Fallback is text-only (images require P2P)
 */

export interface PeerInfo {
	uuid: string;
	streamID: string;
	label?: string;
	connected: boolean;
}

export interface ClipboardPayload {
	type: 'text' | 'image';
	content: string;
	timestamp: number;
	senderId: string;
}

export type ConnectionMode = 'p2p' | 'fallback' | 'connecting';

// No auto-timeout — fallback is only triggered on user action (send)

export class ClipboardBridge {
	private sdk: VDONinjaSDK | null = null;
	private room: string;
	private streamId: string;
	private _peers: Map<string, PeerInfo> = new Map();
	private _onClipboard: ((payload: ClipboardPayload) => void) | null = null;
	private _onPeersChange: ((peers: PeerInfo[]) => void) | null = null;
	private _onConnectionChange: ((connected: boolean) => void) | null = null;
	private _onModeChange: ((mode: ConnectionMode) => void) | null = null;
	private _connected = false;
	private _mode: ConnectionMode = 'connecting';
	private _p2pReady = false;
	private _lastSyncTs = 0;
	private _joined = false;
	private _retryTimer: ReturnType<typeof setInterval> | null = null;
	private _knownStreamIds = new Set<string>();
	private _dcCloseTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(room: string) {
		this.room = room;
		this.streamId = 'clip_' + this.generateId();
	}

	private generateId(): string {
		return Math.random().toString(36).substring(2, 10);
	}

	get mode(): ConnectionMode {
		return this._mode;
	}

	get peers(): PeerInfo[] {
		return Array.from(this._peers.values());
	}

	get connected(): boolean {
		return this._connected;
	}

	onClipboard(fn: (payload: ClipboardPayload) => void) {
		this._onClipboard = fn;
	}

	onPeersChange(fn: (peers: PeerInfo[]) => void) {
		this._onPeersChange = fn;
	}

	onConnectionChange(fn: (connected: boolean) => void) {
		this._onConnectionChange = fn;
	}

	onModeChange(fn: (mode: ConnectionMode) => void) {
		this._onModeChange = fn;
	}

	private setMode(mode: ConnectionMode) {
		if (this._mode === mode) return;
		this._mode = mode;
		this._onModeChange?.(mode);
	}

	private viewListedPeers(detail: any, sdk: VDONinjaSDK) {
		// listing format: { list: [{ streamID, uuid, ... }] }
		const list = detail?.list ?? detail;
		if (!Array.isArray(list)) return;
		for (const peer of list) {
			if (peer.streamID && peer.streamID !== this.streamId) {
				this._knownStreamIds.add(peer.streamID);
				sdk.view(peer.streamID).catch((err: unknown) => {
					console.warn('[clipdrop] view listed peer failed:', err);
				});
			}
		}
	}

	async init() {
		const SDK = (window as any).VDONinjaSDK;
		if (!SDK) {
			console.warn('[clipdrop] SDK not loaded — fallback mode only');
			this.startFallback();
			return;
		}

		const sdk = new SDK({
			debug: true,
			password: false,
			autoRecover: true,
			autoRelay: true
		});
		this.sdk = sdk;

		// Connection status
		sdk.addEventListener('connected', () => {
			console.log('[clipdrop] ✅ signaling connected');
			this._connected = true;
			this._onConnectionChange?.(true);
			// Join room on every successful (re)connection
			this.joinAndAnnounce(sdk);
		});

		sdk.addEventListener('disconnected', () => {
			console.log('[clipdrop] ❌ signaling disconnected');
			this._connected = false;
			this._p2pReady = false;
			this._joined = false;
			this._knownStreamIds.clear(); // Old stream IDs won't be valid after reconnect
			this._onConnectionChange?.(false);
			if (this._mode === 'p2p') {
				this.setMode('connecting');
			}
		});

		sdk.addEventListener('error', (e: CustomEvent) => {
			console.error('[clipdrop] SDK error:', e.detail);
		});

		// Peer events
		sdk.addEventListener('peerConnected', (e: CustomEvent) => {
			console.log('[clipdrop] peerConnected:', e.detail.uuid);
			const { uuid, streamID } = e.detail;
			this._peers.set(uuid, { uuid, streamID: streamID || '', label: 'Peer', connected: true });
			this._onPeersChange?.(this.peers);
			// If streamID is available right away, view immediately
			if (streamID && streamID !== this.streamId) {
				sdk.view(streamID).catch((err: unknown) => {
					console.warn('[clipdrop] view peer failed:', err);
				});
			}
		});

		sdk.addEventListener('peerInfo', (e: CustomEvent) => {
			const { uuid, streamID, info } = e.detail;
			const peer = this._peers.get(uuid);
			if (peer) {
				peer.streamID = streamID || peer.streamID;
				peer.label = info?.label || peer.label;
				this._onPeersChange?.(this.peers);
			}
			// Auto-view discovered peer to establish bidirectional data channel
			if (streamID && streamID !== this.streamId) {
				sdk.view(streamID).catch((err: unknown) => {
					console.warn('[clipdrop] view peer failed:', err);
				});
			}
		});

		sdk.addEventListener('peerDisconnected', (e: CustomEvent) => {
			console.log('[clipdrop] peerDisconnected:', e.detail.uuid);
			const { uuid } = e.detail;
			if (uuid) {
				this._peers.delete(uuid);
				this._onPeersChange?.(this.peers);
			}
			if (this._peers.size === 0) {
				// No peers left — cancel any pending dataChannelClose debounce
				// (peerDisconnected is a definitive signal, no need to wait)
				if (this._dcCloseTimer) {
					clearTimeout(this._dcCloseTimer);
					this._dcCloseTimer = null;
				}
				this._p2pReady = false;
				this.setMode('connecting');
				// No peers left — start looking again
				if (this._joined && this.sdk) {
					this.startDiscoveryRetry(this.sdk);
				}
			}
		});

		// Room listing — discover existing peers and view them
		sdk.addEventListener('listing', (e: CustomEvent) => {
			this.viewListedPeers(e.detail, sdk);
		});

		// peerListing fires when room member list changes (new peer joins)
		sdk.addEventListener('peerListing', (e: CustomEvent) => {
			this.viewListedPeers(e.detail, sdk);
		});

		// Data channel is open — P2P is working!
		sdk.addEventListener('dataChannelOpen', (e: CustomEvent) => {
			console.log('[clipdrop] dataChannelOpen');
			// Cancel any pending close debounce — this is a fresh channel
			if (this._dcCloseTimer) {
				clearTimeout(this._dcCloseTimer);
				this._dcCloseTimer = null;
			}
			this._p2pReady = true;
			this.setMode('p2p');
		});

		sdk.addEventListener('dataChannelClose', (e: CustomEvent) => {
			console.log('[clipdrop] dataChannelClose');
			// Debounce: wait 2s before reacting.
			// SDK fires close for old channels during ICE restart/new connection.
			// If dataChannelOpen fires within 2s, this is just connection replacement — skip.
			if (this._dcCloseTimer) clearTimeout(this._dcCloseTimer);
			this._dcCloseTimer = setTimeout(() => {
				this._dcCloseTimer = null;
				this._p2pReady = false;
				this.setMode('connecting');
				if (this._joined && this.sdk) {
					this.startDiscoveryRetry(this.sdk);
				}
			}, 2000);
		});

		// Incoming P2P data
		sdk.addEventListener('dataReceived', (e: CustomEvent) => {
			const payload = e.detail?.data ?? e.detail;
			if (payload && typeof payload === 'object' && 'type' in payload && 'content' in payload) {
				this._onClipboard?.(payload as ClipboardPayload);
			} else {
				console.warn('[clipdrop] unexpected data shape:', payload);
			}
		});

		// Connect — SDK auto-reconnects on failure, 'connected' event fires each time
		console.log(`[clipdrop] 🚀 init — room: ${this.room}, streamId: ${this.streamId}`);
		sdk.connect().catch((err: unknown) => {
			console.warn('[clipdrop] 🚀 connect() initial attempt failed, SDK will auto-retry:', err);
		});
	}

	private async joinAndAnnounce(sdk: VDONinjaSDK) {
		if (this._joined) return;
		this._joined = true;
		try {
			await sdk.joinRoom({ room: this.room, password: false });
			console.log('[clipdrop] joinRoom done');
			await sdk.announce({ streamID: this.streamId, label: 'clipdrop' });
			console.log('[clipdrop] announce done — waiting for peers');
			// Start periodic retry to handle race condition (both tabs join simultaneously)
			this.startDiscoveryRetry(sdk);
		} catch (err) {
			this._joined = false;
			console.error('[clipdrop] joinRoom/announce failed:', err);
		}
	}

	/**
	 * Periodically re-announce and try to view known peers.
	 * Handles the race condition where both peers join simultaneously
	 * and both get empty listings.
	 * Runs until P2P is established.
	 */
	private startDiscoveryRetry(sdk: VDONinjaSDK) {
		if (this._retryTimer) clearInterval(this._retryTimer);
		this._retryTimer = setInterval(async () => {
			// Stop if P2P is ready, or we already have a peer connected
			// (prevents redundant announce+view while waiting for dataChannelOpen)
			if (this._p2pReady || this._peers.size > 0) {
				if (this._retryTimer) clearInterval(this._retryTimer);
				return;
			}
			// Re-announce so other peers can discover us
			try {
				await sdk.announce({ streamID: this.streamId, label: 'clipdrop' });
			} catch {
				// ignore
			}
			// Try viewing any known peers again
			for (const streamId of this._knownStreamIds) {
				if (streamId !== this.streamId) {
					sdk.view(streamId).catch(() => {});
				}
			}
		}, 2000);
	}

	// ─── HTTP Fallback (on-demand pull) ─────────────────────────

	private startFallback() {
		this._lastSyncTs = Date.now();
		this.setMode('fallback');
	}

	/**
	 * Manually fetch latest entry from KV. Call this on user action
	 * (button click, etc.) instead of polling.
	 */
	async fetchLatest(): Promise<ClipboardPayload | null> {
		try {
			const res = await fetch(`/api/sync?room=${this.room}&since=${this._lastSyncTs}`);
			if (!res.ok) return null;
			const { entries } = await res.json();
			if (Array.isArray(entries) && entries.length > 0) {
				const latest = entries[entries.length - 1];
				if (latest.ts > this._lastSyncTs) {
					this._lastSyncTs = latest.ts;
					const payload: ClipboardPayload = {
						type: 'text',
						content: latest.text,
						timestamp: latest.ts,
						senderId: 'fallback'
					};
					this._onClipboard?.(payload);
					return payload;
				}
			}
		} catch {
			// Network error
		}
		return null;
	}

	// ─── Send ────────────────────────────────────────────────────

	async sendText(text: string) {
		const payload: ClipboardPayload = {
			type: 'text',
			content: text,
			timestamp: Date.now(),
			senderId: this.streamId
		};

		if (this._p2pReady && this.sdk) {
			// P2P send — use _p2pReady (not _mode) so brief 'connecting'
			// during ICE restart doesn't accidentally push us into fallback
			console.log('[clipdrop] P2P send');
			this.sdk.sendData(payload);
			this._onClipboard?.(payload);
		} else {
			// Not P2P — enter fallback mode if not already there
			if (this._mode !== 'fallback') {
				console.log('[clipdrop] P2P not ready — switching to HTTP fallback');
				this.startFallback();
			}
			// HTTP fallback — store in KV
			try {
				await fetch(`/api/sync?room=${this.room}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ text, ts: payload.timestamp })
				});
				this._onClipboard?.(payload);
				console.log('[clipdrop] fallback sent');
			} catch (e) {
				console.error('[clipdrop] fallback send failed:', e);
			}
		}
	}

	async sendImage(dataUrl: string) {
		if (!this._p2pReady || !this.sdk) {
			console.warn('[clipdrop] image send requires P2P — fallback is text-only');
			return;
		}
		const rawBytes = Math.round((dataUrl.length - 22) * 0.75);
		const sizeKB = Math.round(rawBytes / 1024);
		if (rawBytes > 250_000) {
			console.warn(`[clipdrop] image too large: ${sizeKB}KB > 250KB`);
			return;
		}
		console.log(`[clipdrop] sendImage: ${sizeKB}KB`);
		const payload: ClipboardPayload = {
			type: 'image',
			content: dataUrl,
			timestamp: Date.now(),
			senderId: this.streamId
		};
		this.sdk.sendData(payload);
		this._onClipboard?.(payload);
	}

	destroy() {
		if (this._retryTimer) clearInterval(this._retryTimer);
		if (this._dcCloseTimer) clearTimeout(this._dcCloseTimer);
		if (this.sdk) {
			this.sdk.leaveRoom();
			this.sdk.disconnect();
			this.sdk = null;
		}
		this._peers.clear();
	}
}
