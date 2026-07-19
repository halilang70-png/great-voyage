// ClipboardBridge — thin wrapper around VDO Ninja SDK for P2P text/image/whiteboard.
//
// Design follows the official clipboard demo (sdk.vdo.ninja/demos/clipboard.html):
//   - SDK defaults (autoRecover/autoRelay ON) — the SDK owns connection recovery.
//   - quickView({ dataOnly: true }) to connect peers.
//   - No app-level handshake; sendData is fire-and-forget at this layer.
//   - dataChannelOpen/Close are logged only; the SDK rebuilds channels itself.
//
// Earlier versions disabled autoRecover and added a custom handshake + 2s close
// debounce + retry queue. That fought the SDK's own recovery and caused the
// 'alternating send/fail' bug (channel not rebuilt after direction switching).

export type ConnectionMode = 'connecting' | 'p2p' | 'fallback';

export interface ClipboardPayload {
	type: 'text' | 'image';
	content: string;
	timestamp: number;
	senderId: string;
}

export interface PeerInfo {
	uuid: string;
	streamID: string;
	label: string;
	connected: boolean;
}

export interface WhiteboardMsg {
	kind: 'stroke-start' | 'stroke-move' | 'stroke-end' | 'clear';
	ts: number;
	x?: number;
	y?: number;
	color?: string;
	size?: number;
	strokeId?: string;
}

type VDONinjaSDK = any;
type CustomEvent = any;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class ClipboardBridge {
	room: string;
	streamId: string;
	sdk: VDONinjaSDK | null = null;

	private _connected = false;
	private _joined = false;
	private _mode: ConnectionMode = 'connecting';
	private _peers = new Map<string, PeerInfo>();
	private _knownStreamIds = new Set<string>();
	private _retryTimer: ReturnType<typeof setInterval> | null = null;
	private _userFallback = false;
	private _lastSyncTs = 0;

	private _onClipboard: ((p: ClipboardPayload) => void) | null = null;
	private _onPeersChange: ((peers: PeerInfo[]) => void) | null = null;
	private _onConnectionChange: ((c: boolean) => void) | null = null;
	private _onModeChange: ((m: ConnectionMode) => void) | null = null;
	private _onWhiteboard: ((m: WhiteboardMsg) => void) | null = null;

	get mode(): ConnectionMode { return this._mode; }
	get peers(): PeerInfo[] { return [...this._peers.values()]; }

	constructor(room: string) {
		this.room = room;
		this.streamId = 'clip_' + Math.random().toString(36).slice(2, 10);
	}

	onClipboard(fn: (p: ClipboardPayload) => void) { this._onClipboard = fn; }
	onPeersChange(fn: (p: PeerInfo[]) => void) { this._onPeersChange = fn; }
	onConnectionChange(fn: (c: boolean) => void) { this._onConnectionChange = fn; }
	onModeChange(fn: (m: ConnectionMode) => void) { this._onModeChange = fn; }
	onWhiteboard(fn: (m: WhiteboardMsg) => void) { this._onWhiteboard = fn; }

	private setMode(newMode: ConnectionMode) {
		if (this._mode === newMode) return;
		this._mode = newMode;
		this._onModeChange?.(this.mode);
	}

	forceFallback() {
		if (this._userFallback) return;
		this._userFallback = true;
		this.setMode('fallback');
		this._onModeChange?.(this.mode);
	}

	forceP2P() {
		if (!this._userFallback) return;
		this._userFallback = false;
		this.setMode(this._peers.size > 0 ? 'p2p' : 'connecting');
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
		});
		this.sdk = sdk;

		sdk.addEventListener('connected', () => {
			console.log('[clipdrop] signaling connected');
			this._connected = true;
			this._onConnectionChange?.(true);
			this.joinAndAnnounce(sdk);
		});

		sdk.addEventListener('disconnected', () => {
			console.log('[clipdrop] signaling disconnected');
			this._connected = false;
			this._joined = false;
			this._knownStreamIds.clear();
			this._onConnectionChange?.(false);
			if (this._mode === 'p2p') this.setMode('connecting');
		});

		sdk.addEventListener('error', (e: CustomEvent) => {
			console.error('[clipdrop] SDK error:', e.detail);
		});

		sdk.addEventListener('peerConnected', (e: CustomEvent) => {
			const { uuid, streamID } = e.detail;
			this._peers.set(uuid, { uuid, streamID: streamID || '', label: 'Peer', connected: true });
			this._onPeersChange?.(this.peers);
			if (this._mode !== 'p2p') this.setMode('p2p');
		});

		sdk.addEventListener('peerInfo', (e: CustomEvent) => {
			const { uuid, streamID, info } = e.detail;
			const peer = this._peers.get(uuid);
			if (peer) {
				peer.streamID = streamID || peer.streamID;
				peer.label = info?.label || peer.label;
				this._onPeersChange?.(this.peers);
			}
		});

		sdk.addEventListener('peerDisconnected', (e: CustomEvent) => {
			const { uuid } = e.detail;
			if (uuid) {
				this._peers.delete(uuid);
				this._onPeersChange?.(this.peers);
			}
			if (this._peers.size === 0) {
				this.setMode('connecting');
				if (this._joined && this.sdk) this.startDiscoveryRetry(this.sdk);
			}
		});

		sdk.addEventListener('dataChannelOpen', (e: CustomEvent) => {
			console.log('[clipdrop] dataChannelOpen:', e.detail?.uuid);
		});
		sdk.addEventListener('dataChannelClose', (e: CustomEvent) => {
			console.log('[clipdrop] dataChannelClose:', e.detail?.uuid);
		});

		sdk.addEventListener('dataReceived', (e: CustomEvent) => {
			const raw = e.detail?.data ?? e.detail;
			let payload: any = raw;
			if (typeof payload === 'string') {
				try { payload = JSON.parse(payload); }
				catch { /* leave as string */ }
			}
			if (!payload || typeof payload !== 'object') {
				console.warn('[clipdrop] unexpected data shape:', payload);
				return;
			}
			if ('kind' in payload) {
				this._onWhiteboard?.(payload as WhiteboardMsg);
				return;
			}
			if ('type' in payload && 'content' in payload) {
				this._onClipboard?.(payload as ClipboardPayload);
			} else {
				console.warn('[clipdrop] unexpected data shape:', payload);
			}
		});

		sdk.addEventListener('listing', (e: CustomEvent) => this.viewListedPeers(e.detail, sdk));
		sdk.addEventListener('peerListing', (e: CustomEvent) => this.viewListedPeers(e.detail, sdk));

		console.log('[clipdrop] init — room: ' + this.room + ', streamId: ' + this.streamId);
		sdk.connect().catch((err: unknown) => {
			console.warn('[clipdrop] connect() failed, SDK will auto-retry:', err);
		});
	}

	private async joinAndAnnounce(sdk: VDONinjaSDK) {
		if (this._joined) return;
		this._joined = true;
		try {
			await sdk.joinRoom({ room: this.room, password: false });
			await sdk.announce({ streamID: this.streamId, label: 'clipdrop' });
			console.log('[clipdrop] joined + announced');
			this.startDiscoveryRetry(sdk);
		} catch (err) {
			this._joined = false;
			console.error('[clipdrop] join/announce failed:', err);
		}
	}

	private startDiscoveryRetry(sdk: VDONinjaSDK) {
		if (this._retryTimer) clearInterval(this._retryTimer);
		this._retryTimer = setInterval(async () => {
			if (this._peers.size > 0) {
				if (this._retryTimer) clearInterval(this._retryTimer);
				return;
			}
			try {
				await sdk.announce({ streamID: this.streamId, label: 'clipdrop' });
			} catch { /* ignore */ }
			for (const streamId of this._knownStreamIds) {
				if (streamId !== this.streamId) {
					sdk.quickView({ streamID: streamId, audio: false, video: false })
					   .catch(() => {});
				}
			}
		}, 2000);
	}

	private viewListedPeers(detail: any, sdk: VDONinjaSDK) {
		const list = detail?.list ?? detail;
		if (!Array.isArray(list)) return;
		for (const peer of list) {
			if (peer.streamID && peer.streamID !== this.streamId) {
				this._knownStreamIds.add(peer.streamID);
				sdk.quickView({ streamID: peer.streamID, audio: false, video: false })
				   .catch((err: unknown) => console.warn('[clipdrop] quickView failed:', err));
			}
		}
	}

	private startFallback() {
		this._lastSyncTs = Date.now();
		this.setMode('fallback');
	}

	async fetchLatest(): Promise<ClipboardPayload | null> {
		try {
			const res = await fetch('/api/sync?room=' + this.room + '&since=' + this._lastSyncTs);
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
		} catch { /* network error */ }
		return null;
	}

	async sendText(text: string): Promise<boolean> {
		const payload: ClipboardPayload = {
			type: 'text',
			content: text,
			timestamp: Date.now(),
			senderId: this.streamId
		};
		if (this._userFallback) {
			try {
				await fetch('/api/sync?room=' + this.room, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ text, ts: payload.timestamp })
				});
				this._onClipboard?.(payload);
				return true;
			} catch (e) {
				console.error('[clipdrop] fallback send failed:', e);
				return false;
			}
		}
		if (!this.sdk) return false;
		try {
			const ok = this.sdk.sendData(payload);
			if (ok) this._onClipboard?.(payload);
			return ok;
		} catch (err) {
			console.warn('[clipdrop] sendText failed:', err);
			return false;
		}
	}

	async sendImage(dataUrl: string): Promise<boolean> {
		if (this._userFallback) {
			console.warn('[clipdrop] image send requires P2P');
			return false;
		}
		if (!this.sdk) return false;
		const rawBytes = Math.round((dataUrl.length - 22) * 0.75);
		if (rawBytes > 250_000) {
			console.warn('[clipdrop] image too large: ' + Math.round(rawBytes / 1024) + 'KB > 250KB');
			return false;
		}
		const payload: ClipboardPayload = {
			type: 'image',
			content: dataUrl,
			timestamp: Date.now(),
			senderId: this.streamId
		};
		try {
			const ok = this.sdk.sendData(payload);
			if (ok) this._onClipboard?.(payload);
			return ok;
		} catch (err) {
			console.warn('[clipdrop] sendImage failed:', err);
			return false;
		}
	}

	sendWhiteboard(msg: WhiteboardMsg): boolean {
		if (!this.sdk) return false;
		try {
			return this.sdk.sendData(msg);
		} catch (err) {
			console.warn('[clipdrop] whiteboard send failed:', err);
			return false;
		}
	}

	destroy() {
		if (this._retryTimer) clearInterval(this._retryTimer);
		if (this.sdk) {
			try { this.sdk.leaveRoom(); } catch {}
			try { this.sdk.disconnect(); } catch {}
			this.sdk = null;
		}
		this._peers.clear();
	}
}
