/**
 * localStorage helpers for settings and history persistence.
 */

import type { ClipboardPayload } from './vdo';

const PREFIX = 'clipdrop:';

// ─── Settings ─────────────────────────────────────────────

export interface Settings {
	autoCopy: boolean;
	soundEnabled: boolean;
}

const DEFAULT_SETTINGS: Settings = {
	autoCopy: false,
	soundEnabled: true
};

export function getSettings(): Settings {
	try {
		const raw = localStorage.getItem(PREFIX + 'settings');
		if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
	} catch {}
	return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Partial<Settings>) {
	const current = getSettings();
	localStorage.setItem(PREFIX + 'settings', JSON.stringify({ ...current, ...settings }));
}

// ─── History (per room) ───────────────────────────────────

const MAX_HISTORY = 100;

export function loadHistory(room: string): ClipboardPayload[] {
	try {
		const raw = localStorage.getItem(PREFIX + 'history:' + room);
		if (raw) return JSON.parse(raw);
	} catch {}
	return [];
}

export function saveHistory(room: string, history: ClipboardPayload[]) {
	try {
		localStorage.setItem(PREFIX + 'history:' + room, JSON.stringify(history.slice(0, MAX_HISTORY)));
	} catch {
			// Storage full — drop oldest
			localStorage.removeItem(PREFIX + 'history:' + room);
		}
	}
