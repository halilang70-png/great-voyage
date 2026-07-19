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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

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
	private _userFallback = false;

	// P2P readiness handshake: wait for bidirectional confirmation before
	// marking the data channel as ready.  This prevents the first message
	// from being lost when the remote SCTP association isn't fully up yet
	// (common with background-tab throttling).
	private _handshakePending = false;
	private _handshakeAcked = false;
	private _handshakeTimer: ReturnType<typeof setTimeout> | null = null;
	private _msgQueue: ClipboardPayload[] = [];

	constructor(room: string) {
		this.room = room;
		this.streamId = 'clip_' + this.generateId();
	}

	private generateId(): string {
		return Math.random().toString(36).substring(2, 10);
	}

	get mode(): ConnectionMode {
		if (this._userFallback) return 'fallback';
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

	private setMode(newMode: ConnectionMode) {
		if (this._mode === newMode) return;
		this._mode = newMode;
		this._onModeChange?.(this.mode);
	}

	/** Switch to manual fallback (KV) mode */
	forceFallback() {
		if (this._userFallback) return;
		this._userFallback = true;
		this.startFallback();
		this._onModeChange?.(this.mode);
	}

	/** Switch back to P2P mode */
	forceP2P() {
		if (!this._userFallback) return;
		this._userFallback = false;
		// Re-evaluate mode
		if (this._mode === 'p2p') {
			this._onModeChange?.(this.mode);
		} else {
			this.setMode('connecting');
			if (this._joined && this.sdk) {
				this.startDiscoveryRetry(this.sdk);
			}
		}
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
			this._handshakePending = false;
			this._handshakeAcked = false;
			if (this._handshakeTimer) {
				clearTimeout(this._handshakeTimer);
				this._handshakeTimer = null;
			}
			this._joined = false;
			this._knownStreamIds.clear();
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
				if (this._dcCloseTimer) {
					clearTimeout(this._dcCloseTimer);
					this._dcCloseTimer = null;
				}
				// Cancel pending handshake
				this._handshakePending = false;
				if (this._handshakeTimer) {
					clearTimeout(this._handshakeTimer);
					this._handshakeTimer = null;
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

		// Data channel is open — initiate handshake to verify bidirectional readiness
		sdk.addEventListener('dataChannelOpen', (e: CustomEvent) => {
			console.log('[clipdrop] dataChannelOpen — starting handshake');
			// Cancel any pending close debounce — this is a fresh channel
			if (this._dcCloseTimer) {
				clearTimeout(this._dcCloseTimer);
				this._dcCloseTimer = null;
			}
			// Don't mark P2P ready yet — wait for handshake ack from peer
			this._startHandshake(sdk);
		});

		sdk.addEventListener('dataChannelClose', (e: CustomEvent) => {
			console.log('[clipdrop] dataChannelClose');
			// Immediately mark P2P as not ready so new sends are queued (or fail)
			// rather than being written to a closing channel. The queue is preserved
			// so messages sent during the close->open window are flushed once the
			// new channel finishes its handshake.
			this._p2pReady = false;
			this._handshakePending = false;
			this._handshakeAcked = false;
			if (this._handshakeTimer) {
				clearTimeout(this._handshakeTimer);
				this._handshakeTimer = null;
			}
			// Debounce mode change + discovery retry: SDK fires close for old
			// channels during ICE restart; if dataChannelOpen fires within 2s
			// this is just connection replacement and we skip the reconnect work.
			if (this._dcCloseTimer) clearTimeout(this._dcCloseTimer);
			this._dcCloseTimer = setTimeout(() => {
				this._dcCloseTimer = null;
				this.setMode('connecting');
				if (this._joined && this.sdk) {
					this.startDiscoveryRetry(this.sdk);
				}
			}, 2000);
		});

		// Incoming P2P data
		sdk.addEventListener('dataReceived', (e: CustomEvent) => {
			const raw = e.detail?.data ?? e.detail;
			// SDK may deliver data as a JSON string (depending on transport path
			// and SDK version); normalize to object so the shape checks below work.
			// Without this, string payloads fell through to the warn branch and
			// messages were silently dropped.
			let payload: any = raw;
			if (typeof payload === 'string') {
				try {
					payload = JSON.parse(payload);
				} catch {
					// not JSON — leave as string; will hit the warn branch below
				}
			}
			// Handle P2P readiness handshake (internal protocol)
			if (payload && typeof payload === 'object' && 'clipdrop' in payload) {
				this._handleHandshake(payload, sdk);
				return;
			}
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

	// ─── P2P Readiness Handshake ─────────────────────────────────

	/**
	 * Send a lightweight handshake ping to verify the remote peer's
	 * data channel is truly ready to receive. The peer responds with
	 * a handshake-ack; only then do we mark P2P as ready.
	 */
	private _startHandshake(sdk: VDONinjaSDK) {
		this._handshakePending = true;
		this._handshakeAcked = false;

		if (this._handshakeTimer) clearTimeout(this._handshakeTimer);

		// Timeout: if no ack in 3s, assume ready anyway
		this._handshakeTimer = setTimeout(() => {
			if (this._handshakePending && !this._handshakeAcked) {
				console.warn('[clipdrop] handshake timeout - assuming P2P ready');
				this._finalizeHandshake();
			}
		}, 3000);

		try {
			sdk.sendData({ clipdrop: 'handshake', ts: Date.now() });
			console.log('[clipdrop] handshake sent');
		} catch (err) {
			console.warn('[clipdrop] handshake send failed:', err);
			this._finalizeHandshake();
		}
	}

	/** Handle incoming handshake messages. Returns true if handled. */
	private _handleHandshake(msg: any, sdk: VDONinjaSDK): boolean {
		if (msg.clipdrop === 'handshake') {
			// Peer is checking if we're ready — reply with ack
			console.log('[clipdrop] handshake received, sending ack');
			try {
				sdk.sendData({ clipdrop: 'handshake-ack', ts: msg.ts });
			} catch (err) {
				console.warn('[clipdrop] handshake-ack send failed:', err);
			}
			// The ack itself proves we can send; mark ready
			if (!this._p2pReady) {
				this._finalizeHandshake();
			}
			return true;
		}
		if (msg.clipdrop === 'handshake-ack') {
			console.log('[clipdrop] handshake-ack received');
			this._handshakeAcked = true;
			this._finalizeHandshake();
			return true;
		}
		return false;
	}

	/** Mark P2P as ready and flush any queued messages */
	private _finalizeHandshake() {
		if (this._handshakeTimer) {
			clearTimeout(this._handshakeTimer);
			this._handshakeTimer = null;
		}
		this._handshakePending = false;

		if (!this._p2pReady) {
			this._p2pReady = true;
			this.setMode('p2p');
			console.log('[clipdrop] P2P fully ready (handshake complete)');
		}
		// Always flush the queue - even if P2P was already marked ready,
		// messages queued during a re-handshake (e.g. after ICE restart)
		// must still be delivered. Without this they were silently lost.
		this._flushQueue();
	}

	/** Send all queued messages now that P2P is ready */
	private _flushQueue() {
		if (this._msgQueue.length === 0) return;
		console.log(`[clipdrop] flushing ${this._msgQueue.length} queued message(s)`);
		const queue = [...this._msgQueue];
		this._msgQueue = [];
		for (const payload of queue) {
			try {
				const ok = this.sdk?.sendData(payload);
				if (ok) {
					this._onClipboard?.(payload);
					console.log('[clipdrop] queued P2P send');
					continue;
				}
				console.warn('[clipdrop] queued P2P sendData returned false, re-queuing');
			} catch (err) {
				console.warn('[clipdrop] queued P2P send failed, re-queuing:', err);
			}
			// Re-queue for the next handshake/open event; cap to avoid
			// unbounded growth if the channel stays broken.
			if (this._msgQueue.length < 20) {
				this._msgQueue.push(payload);
			}
		}
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

	async sendText(text: string): Promise<boolean> {
		const payload: ClipboardPayload = {
			type: 'text',
			content: text,
			timestamp: Date.now(),
			senderId: this.streamId
		};

		// Manual fallback — always use HTTP
		if (this._userFallback) {
			try {
				await fetch(`/api/sync?room=${this.room}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ text, ts: payload.timestamp })
				});
				this._onClipboard?.(payload);
				console.log('[clipdrop] fallback sent');
				return true;
			} catch (e) {
				console.error('[clipdrop] fallback send failed:', e);
				return false;
			}
		}

		// P2P fully ready — send directly
		if (this._p2pReady && this.sdk) {
			for (let i = 0; i < 3; i++) {
				try {
					// sendData returns boolean: false means the channel could not
					// accept the message (buffer full, channel closing, etc.).
					// Without checking this, the UI reported success while the
					// message was silently dropped.
					const ok = this.sdk.sendData(payload);
					if (ok) {
						this._onClipboard?.(payload);
						console.log('[clipdrop] P2P send');
						return true;
					}
					console.warn(`[clipdrop] P2P sendData returned false on attempt ${i + 1}`);
				} catch (err) {
					console.warn(`[clipdrop] P2P send attempt ${i + 1} failed:`, err);
				}
				if (i < 2) await sleep(500);
			}
			console.warn('[clipdrop] P2P send failed after 3 attempts');
			return false;
		}

		// Handshake in progress — queue the message for immediate flush
		if (this._handshakePending && this.sdk) {
			this._msgQueue.push(payload);
			console.log('[clipdrop] P2P handshake in progress — message queued');
			return true;
		}

		console.warn('[clipdrop] P2P not ready');
		return false;
	}

	async sendImage(dataUrl: string): Promise<boolean> {
		if (this._userFallback) {
			console.warn('[clipdrop] image send requires P2P — currently in fallback mode');
			return false;
		}
		if (!this._p2pReady || !this.sdk) {
			if (this._handshakePending && this.sdk) {
				console.warn('[clipdrop] image send queued during handshake');
				// Images are too large to queue safely; wait for handshake then retry
				await new Promise<void>((resolve) => {
					let settled = false;
					let pollTimer: ReturnType<typeof setTimeout> | null = null;
					const finish = () => {
						if (settled) return;
						settled = true;
						if (pollTimer) clearTimeout(pollTimer);
						if (timeoutTimer) clearTimeout(timeoutTimer);
						resolve();
					};
					const check = () => {
						if (settled) return;
						if (this._p2pReady || !this._handshakePending) {
							finish();
						} else {
							pollTimer = setTimeout(check, 100);
						}
					};
					// Max wait 4s (handshake timeout is 3s)
					const timeoutTimer = setTimeout(finish, 4000);
					check();
				});
				if (!this._p2pReady || !this.sdk) {
					console.warn('[clipdrop] image send failed — P2P not ready after handshake');
					return false;
				}
			} else {
				console.warn('[clipdrop] image send requires P2P');
				return false;
			}
		}
		const rawBytes = Math.round((dataUrl.length - 22) * 0.75);
		const sizeKB = Math.round(rawBytes / 1024);
		if (rawBytes > 250_000) {
			console.warn(`[clipdrop] image too large: ${sizeKB}KB > 250KB`);
			return false;
		}
		console.log(`[clipdrop] sendImage: ${sizeKB}KB`);
		const payload: ClipboardPayload = {
			type: 'image',
			content: dataUrl,
			timestamp: Date.now(),
			senderId: this.streamId
		};
		for (let i = 0; i < 3; i++) {
			try {
				const ok = this.sdk.sendData(payload);
				if (ok) {
					this._onClipboard?.(payload);
					return true;
				}
				console.warn(`[clipdrop] sendImage sendData returned false on attempt ${i + 1}`);
			} catch (err) {
				console.warn(`[clipdrop] sendImage attempt ${i + 1} failed:`, err);
			}
			if (i < 2) await sleep(500);
		}
		console.warn('[clipdrop] sendImage failed after 3 attempts');
		return false;
	}

	destroy() {
		if (this._retryTimer) clearInterval(this._retryTimer);
		if (this._dcCloseTimer) clearTimeout(this._dcCloseTimer);
		if (this._handshakeTimer) clearTimeout(this._handshakeTimer);
		this._msgQueue = [];
		if (this.sdk) {
			this.sdk.leaveRoom();
			this.sdk.disconnect();
			this.sdk = null;
		}
		this._peers.clear();
	}
}
