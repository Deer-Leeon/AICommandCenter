// Type declarations for the Spotify Web Playback SDK
// https://developer.spotify.com/documentation/web-playback-sdk/reference/

declare namespace Spotify {
  interface Player {
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(event: 'ready', cb: (data: { device_id: string }) => void): void;
    addListener(event: 'not_ready', cb: (data: { device_id: string }) => void): void;
    addListener(event: 'player_state_changed', cb: (state: PlaybackState | null) => void): void;
    addListener(event: 'initialization_error', cb: (data: { message: string }) => void): void;
    addListener(event: 'authentication_error', cb: (data: { message: string }) => void): void;
    addListener(event: 'account_error', cb: (data: { message: string }) => void): void;
    removeListener(event: string, cb?: (...args: unknown[]) => void): void;
    getCurrentState(): Promise<PlaybackState | null>;
    setName(name: string): Promise<void>;
    getVolume(): Promise<number>;
    setVolume(volume: number): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    togglePlay(): Promise<void>;
    seek(positionMs: number): Promise<void>;
    previousTrack(): Promise<void>;
    nextTrack(): Promise<void>;
  }

  interface PlayerConstructorOptions {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }

  interface PlaybackState {
    context: { uri: string | null; metadata: Record<string, unknown> };
    disallows: Record<string, boolean>;
    duration: number;
    paused: boolean;
    position: number;
    repeat_mode: 0 | 1 | 2;
    shuffle: boolean;
    track_window: {
      current_track:    WebPlaybackTrack;
      previous_tracks:  WebPlaybackTrack[];
      next_tracks:      WebPlaybackTrack[];
    };
  }

  interface WebPlaybackTrack {
    uri:    string;
    id:     string;
    type:   string;
    name:   string;
    duration_ms: number;
    artists: { uri: string; name: string }[];
    album: {
      uri:    string;
      name:   string;
      images: { url: string }[];
    };
    is_playable: boolean;
    linked_from?: { uri: string | null; id: string | null };
  }

  // eslint-disable-next-line @typescript-eslint/no-misused-new
  interface PlayerConstructor {
    new(options: PlayerConstructorOptions): Player;
  }

  const Player: PlayerConstructor;
}

interface Window {
  Spotify: typeof Spotify;
  onSpotifyWebPlaybackSDKReady: () => void;
}
