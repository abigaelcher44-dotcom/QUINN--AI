/** User-added apps that QUINN can launch (web apps, deep links, local protocols). */

export interface QuinnApp {
  id: string;
  name: string;
  url: string;
  emoji: string;
  addedAt: number;
}

const KEY = "quinn.apps";

export function listApps(): QuinnApp[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function addApp(app: Omit<QuinnApp, "id" | "addedAt">): QuinnApp {
  const next: QuinnApp = { ...app, id: crypto.randomUUID(), addedAt: Date.now() };
  localStorage.setItem(KEY, JSON.stringify([...listApps(), next]));
  return next;
}

export function removeApp(id: string) {
  localStorage.setItem(KEY, JSON.stringify(listApps().filter((a) => a.id !== id)));
}

export function launchApp(app: QuinnApp) {
  window.open(app.url, "_blank", "noopener,noreferrer");
}
