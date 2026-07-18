import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * POST /api/sync?room=xxx
 * Body: { text: string, ts: number }
 * Stores text in KV for a room.
 *
 * GET /api/sync?room=xxx&since=0
 * Returns latest text for a room (if newer than `since`).
 *
 * This is the HTTP fallback when P2P DataChannel fails.
 */

const MAX_TEXT_LENGTH = 64 * 1024; // 64KB max per text entry
const TTL_SECONDS = 3600; // 1 hour expiry

export const POST: RequestHandler = async ({ url, request, platform }) => {
	const room = url.searchParams.get('room');
	if (!room) return error(400, 'missing room param');

	const body = await request.json().catch(() => null);
	if (!body?.text || typeof body.text !== 'string') {
		return error(400, 'missing text field');
	}

	if (body.text.length > MAX_TEXT_LENGTH) {
		return error(413, `text too large (max ${MAX_TEXT_LENGTH} bytes)`);
	}

	const kv = platform?.env?.SYNC;
	if (!kv) {
		return error(503, 'KV not configured — add SYNC binding in wrangler.toml');
	}

	const ts = body.ts || Date.now();
	const key = `clip:${room}`;

	// Store with metadata
	await kv.put(key, JSON.stringify({ text: body.text, ts }), {
		expirationTtl: TTL_SECONDS
	});

	// Also maintain a list of recent entries for "since" queries
	const listKey = `clip:${room}:list`;
	const existing = await kv.get(listKey, { type: 'json' }).catch(() => []);
	const entries = Array.isArray(existing) ? existing : [];
	entries.push({ text: body.text, ts });

	// Keep only last 20 entries
	const trimmed = entries.slice(-20);
	await kv.put(listKey, JSON.stringify(trimmed), {
		expirationTtl: TTL_SECONDS
	});

	return json({ ok: true, ts });
};

export const GET: RequestHandler = async ({ url, platform }) => {
	const room = url.searchParams.get('room');
	if (!room) return error(400, 'missing room param');

	const since = Number(url.searchParams.get('since') || 0);

	const kv = platform?.env?.SYNC;
	if (!kv) {
		return error(503, 'KV not configured — add SYNC binding in wrangler.toml');
	}

	const listKey = `clip:${room}:list`;
	const entries = await kv.get(listKey, { type: 'json' }).catch(() => []);

	if (!Array.isArray(entries) || entries.length === 0) {
		return json({ entries: [] });
	}

	// Return entries newer than `since`
	const filtered = since > 0 ? entries.filter((e: any) => e.ts > since) : entries.slice(-1);

	return json({ entries: filtered });
};
