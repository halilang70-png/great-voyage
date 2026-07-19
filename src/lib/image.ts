/**
 * Compress and resize an image for P2P transfer via DataChannel.
 *
 * WebRTC DataChannel has a ~256KB message size limit.
 * Base64 encoding adds 33% overhead.
 * So target raw JPEG < 180KB → ~240KB base64 → safe for DataChannel.
 */

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const JPEG_QUALITY = 0.92;
const MAX_BYTES = 250_000; // 250KB raw JPEG — near DataChannel limit

export function compressImage(
	file: Blob,
	maxWidth = MAX_WIDTH,
	maxHeight = MAX_HEIGHT,
	quality = JPEG_QUALITY
): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(file);

		img.onload = () => {
			URL.revokeObjectURL(url);

			let w = img.naturalWidth;
			let h = img.naturalHeight;

			// Scale down if needed
			if (w > maxWidth || h > maxHeight) {
				const ratio = Math.min(maxWidth / w, maxHeight / h);
				w = Math.round(w * ratio);
				h = Math.round(h * ratio);
			}

			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(img, 0, 0, w, h);

			// Start with high quality, reduce only if over DataChannel limit
			let q = quality;
			let dataUrl: string;
			do {
				dataUrl = canvas.toDataURL('image/jpeg', q);
				const byteLength = Math.round((dataUrl.length - 22) * 0.75);
				if (byteLength <= MAX_BYTES) break;
				q -= 0.1;
			} while (q > 0.1);

			resolve(dataUrl);
		};

		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load image'));
		};

		img.src = url;
	});
}

/**
 * Check if a base64 data URL is within DataChannel limits.
 * Returns true if safe to send as single message.
 */
export function isWithinDataChannelLimit(dataUrl: string): boolean {
	const byteLength = Math.round((dataUrl.length - 22) * 0.75);
	return byteLength <= 250_000; // 250KB safety limit
}

/**
 * Split a large data URL into chunks for manual transfer.
 */
export function chunkDataUrl(dataUrl: string, chunkSize = 200_000): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < dataUrl.length; i += chunkSize) {
		chunks.push(dataUrl.slice(i, i + chunkSize));
	}
	return chunks;
}
