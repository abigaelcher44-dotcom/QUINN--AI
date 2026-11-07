export {};

declare global {
  interface Window {
    quinnDesktop?: {
      openDashboard: () => void;
      minimizeCompanion: () => void;
      closeCompanion: () => void;
      synthesizeVoice: (text: string, profileId?: "goku" | "vegeta") => Promise<string | null>;
    };
  }
}
