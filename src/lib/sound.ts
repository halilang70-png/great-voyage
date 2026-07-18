/**
 * Synthesized notification sounds — no audio files needed.
 * Uses Web Audio API oscillators to generate tones.
 */

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
	if (!ctx) {
		ctx = new AudioContext();
	}
	return ctx;
}

/**
 * Short pleasant "ding" — two-note ascending chime.
 * Perfect for clipboard receive notification.
 */
export function playReceive() {
	const ac = getCtx();
	const now = ac.currentTime;

	// Note 1
	const osc1 = ac.createOscillator();
	const gain1 = ac.createGain();
	osc1.type = 'sine';
	osc1.frequency.value = 880; // A5
	gain1.gain.setValueAtTime(0, now);
	gain1.gain.linearRampToValueAtTime(0.15, now + 0.02);
	gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
	osc1.connect(gain1).connect(ac.destination);
	osc1.start(now);
	osc1.stop(now + 0.25);

	// Note 2 — higher, overlapping
	const osc2 = ac.createOscillator();
	const gain2 = ac.createGain();
	osc2.type = 'sine';
	osc2.frequency.value = 1320; // E6
	gain2.gain.setValueAtTime(0, now + 0.08);
	gain2.gain.linearRampToValueAtTime(0.12, now + 0.1);
	gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
	osc2.connect(gain2).connect(ac.destination);
	osc2.start(now + 0.08);
	osc2.stop(now + 0.4);
}

/**
 * Subtle "pop" for send confirmation.
 */
export function playSend() {
	const ac = getCtx();
	const now = ac.currentTime;

	const osc = ac.createOscillator();
	const gain = ac.createGain();
	osc.type = 'triangle';
	osc.frequency.setValueAtTime(600, now);
	osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
	gain.gain.setValueAtTime(0.12, now);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
	osc.connect(gain).connect(ac.destination);
	osc.start(now);
	osc.stop(now + 0.12);
}

/**
 * Error / warning tone.
 */
export function playError() {
	const ac = getCtx();
	const now = ac.currentTime;

	const osc = ac.createOscillator();
	const gain = ac.createGain();
	osc.type = 'square';
	osc.frequency.setValueAtTime(300, now);
	osc.frequency.setValueAtTime(200, now + 0.1);
	gain.gain.setValueAtTime(0.08, now);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
	osc.connect(gain).connect(ac.destination);
	osc.start(now);
	osc.stop(now + 0.2);
}
