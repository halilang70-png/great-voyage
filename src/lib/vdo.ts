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

	async init() {
		const SDK = (window as any).VDONinjaSDK;
		if (!SDK) {
			console.warn('[clipdrop] SDK not loaded — fallback mode only');
			this.startFallback();
			return;
		}

		const sdk = new SDK({
			debug: false,
			password: false,
			autoRecover: true,
			autoRelay: true
		});
		this.sdk = sdk;

		// Connection status
		sdk.addEventListener('connected', () => {
			this._connected = true;
			this._onConnectionChange?.(true);
		});

		sdk.addEventListener('disconnected', () => {
			this._connected = false;
			this._p2pReady = false;
			this._onConnectionChange?.(false);
			// Go back to connecting — next send will trigger fallback if needed
			if (this._mode === 'p2p') {
				this.setMode('connecting');
			}
		});

		sdk.addEventListener('error', (e: CustomEvent) => {
			console.error('[clipdrop] SDK error:', e.detail);
		});

		// Peer events
		sdk.addEventListener('peerConnected', (e: CustomEvent) => {
			const { uuid } = e.detail;
			this._peers.set(uuid, { uuid, streamID: '', label: 'Peer', connected: true });
			this._onPeersChange?.(this.peers);
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
				console.log(`[clipdrop] auto-viewing peer: ${streamID}`);
				sdk.view(streamID).catch((err: unknown) => {
					console.warn('[clipdrop] view failed:', err);
				});
			}
		});

		// Room listing — discover existing peers and view them
		sdk.addEventListener('listing', (e: CustomEvent) => {
			const list = e.detail?.list;
			if (!Array.isArray(list)) return;
			for (const peer of list) {
				if (peer.streamID && peer.streamID !== this.streamId) {
					console.log(`[clipdrop] viewing listed peer: ${peer.streamID}`);
					sdk.view(peer.streamID).catch((err: unknown) => {
						console.warn('[clipdrop] view listed peer failed:', err);
					});
				}
			}
		});

		// Data channel is open — P2P is working!
		sdk.addEventListener('dataChannelOpen', () => {
			this._p2pReady = true;
			this.setMode('p2p');
		});

		// Incoming P2P data
		sdk.addEventListener('dataReceived', (e: CustomEvent) => {
			const { data } = e.detail;
			if (data && typeof data === 'object' && 'type' in data && 'content' in data) {
				this._onClipboard?.(data as ClipboardPayload);
			}
		});

		// Connect
		await sdk.connect();
		await sdk.joinRoom({ room: this.room, password: false });
		await sdk.announce({ streamID: this.streamId, label: 'clipdrop' });
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

		if (this._mode === 'connecting') {
			// User tried to send but P2P hasn't connected yet — fall back now
			console.log('[clipdrop] P2P not ready at send time — switching to HTTP fallback');
			this.startFallback();
		}

		if (this._mode === 'p2p' && this.sdk) {
			// P2P send
			this.sdk.sendData(payload);
			this._onClipboard?.(payload);
		} else {
			// HTTP fallback — store in KV
			try {
				await fetch(`/api/sync?room=${this.room}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ text, ts: payload.timestamp })
				});
				this._onClipboard?.(payload);
			} catch (e) {
				console.error('[clipdrop] fallback send failed:', e);
			}
		}
	}

	async sendImage(dataUrl: string) {
		if (this._mode !== 'p2p' || !this.sdk) {
			console.warn('[clipdrop] image send requires P2P — fallback is text-only');
			return;
		}
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
		if (this.sdk) {
			this.sdk.leaveRoom();
			this.sdk.disconnect();
			this.sdk = null;
		}
		this._peers.clear();
	}
}
