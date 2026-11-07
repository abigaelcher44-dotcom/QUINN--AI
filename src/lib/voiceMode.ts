export type QuinnVoiceCharacter = "goku" | "vegeta";

const STORAGE_KEY = "quinn.voice.character";
const LEGACY_KEY = "quinn.venom-mode";
const CHANGE_EVENT = "quinn:voice-character-changed";

export function getVoiceCharacter(): QuinnVoiceCharacter {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved === "goku" || saved === "vegeta") return saved;

    const legacy = localStorage.getItem(LEGACY_KEY);
    const migrated = legacy === "true" ? "vegeta" : "goku";

    localStorage.setItem(STORAGE_KEY, migrated);
    return migrated;
  } catch {
    return "goku";
  }
}

export function setVoiceCharacter(character: QuinnVoiceCharacter): void {
  try {
    localStorage.setItem(STORAGE_KEY, character);
    window.dispatchEvent(
      new CustomEvent(CHANGE_EVENT, { detail: { character } }),
    );
  } catch {
    // Keep QUINN usable if storage is unavailable.
  }
}

export function onVoiceCharacterChanged(
  callback: (character: QuinnVoiceCharacter) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleChange = (event: Event) => {
    const character = (event as CustomEvent<{ character?: QuinnVoiceCharacter }>).detail?.character;
    callback(character === "vegeta" || character === "goku" ? character : getVoiceCharacter());
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === LEGACY_KEY) {
      callback(getVoiceCharacter());
    }
  };

  window.addEventListener(CHANGE_EVENT, handleChange);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(CHANGE_EVENT, handleChange);
    window.removeEventListener("storage", handleStorage);
  };
}
