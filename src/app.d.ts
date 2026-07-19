// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				SYNC: KVNamespace;
			};
		}
	}

	interface VDONinjaSDKOptions {
		host?: string;
		room?: string;
		password?: string | false;
		salt?: string;
		debug?: boolean;
		[key: string]: unknown;
	}

	class VDONinjaSDK extends EventTarget {
		constructor(options?: VDONinjaSDKOptions);
		connect(): Promise<void>;
		joinRoom(options: { room: string; password?: string | false }): Promise<void>;
		leaveRoom(): void;
		disconnect(): void;
		announce(options: { streamID: string; label?: string }): Promise<void>;
		view(streamID: string, options?: { audio?: boolean; video?: boolean; label?: string }): Promise<void>;
		sendData(data: unknown, target?: string | object): boolean;
		stopPublishing(): void;
		stopViewing(streamID?: string): void;
		addEventListener(type: string, listener: (event: CustomEvent) => void): void;
	}
}

export {};
