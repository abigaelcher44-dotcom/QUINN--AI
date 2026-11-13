import { Capacitor } from "@capacitor/core";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

const KEYS_STORAGE_ID = "quinn_provider_keys_v1";
const PRIMARY_STORAGE_ID = "quinn_primary_provider_v1";

export type StoredApiKeys = Record<string, string>;

export function isNativeSecureStorage(): boolean {
  return Capacitor.isNativePlatform();
}

export async function readApiKeys(): Promise<StoredApiKeys> {
  const value = await SecureStorage.get(KEYS_STORAGE_ID);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: StoredApiKeys = {};
  for (const [name, key] of Object.entries(value)) {
    if (typeof key === "string" && key.trim()) result[name] = key;
  }
  return result;
}

export async function readPrimaryProvider(): Promise<string> {
  const value = await SecureStorage.get(PRIMARY_STORAGE_ID);
  return typeof value === "string" ? value : "";
}

export async function saveApiKeys(
  keys: StoredApiKeys,
  primary: string,
): Promise<void> {
  await SecureStorage.set(KEYS_STORAGE_ID, keys);
  await SecureStorage.set(PRIMARY_STORAGE_ID, primary);
}

const PROVIDER_NAMES: Record<string, string> = {
  GEMINI_API_KEY: "gemini",
  OPENROUTER_API_KEY: "openrouter",
};

export async function getChatCredential(): Promise<{
  provider: string;
  providerKey: string;
} | null> {
  const keys = await readApiKeys();
  const primary = (await readPrimaryProvider()).trim().toLowerCase();

  const entries = Object.entries(keys);
  if (!entries.length) return null;

  let selected = entries.find(([name]) =>
    PROVIDER_NAMES[name] === primary || name.toLowerCase() === `${primary}_api_key`
  );

  if (!selected) {
    selected = entries.find(([name]) => PROVIDER_NAMES[name] === "gemini")
      ?? entries.find(([name]) => PROVIDER_NAMES[name] === "openrouter");
  }

  if (!selected) return null;

  const [name, providerKey] = selected;
  const provider = PROVIDER_NAMES[name];
  if (!provider || !providerKey.trim()) return null;

  return { provider, providerKey: providerKey.trim() };
}
