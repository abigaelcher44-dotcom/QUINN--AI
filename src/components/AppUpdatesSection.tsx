import { useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Download, RefreshCw, ShieldCheck, Smartphone, ExternalLink } from "lucide-react";

interface QuinnUpdaterPlugin {
  getAppInfo(): Promise<{ version: string; platform: string }>;
  downloadUpdate(options: {
    url: string;
    checksumUrl: string;
    fileName: string;
  }): Promise<{ fileName: string; sha256: string; bytes: number }>;
  canInstallPackages(): Promise<{ allowed: boolean }>;
  openInstallSettings(): Promise<void>;
  installUpdate(options: { fileName: string; sha256: string }): Promise<{
    permissionRequired: boolean;
    installerOpened?: boolean;
  }>;
}

const QuinnUpdater = registerPlugin<QuinnUpdaterPlugin>("QuinnUpdater");
const RELEASE_API = "https://api.github.com/repos/abigaelcher44-dotcom/QUINN--AI/releases/latest";

type Release = {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
};

function versionParts(value: string): number[] {
  const match = value.replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Unsupported version format: ${value}`);
  return match.slice(1).map(Number);
}

function isNewer(remote: string, current: string): boolean {
  const a = versionParts(remote);
  const b = versionParts(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

function trustedReleaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com";
  } catch {
    return false;
  }
}

export default function AppUpdatesSection() {
  const android = Capacitor.getPlatform() === "android";
  const [currentVersion, setCurrentVersion] = useState("");
  const [release, setRelease] = useState<Release | null>(null);
  const [apkName, setApkName] = useState("");
  const [status, setStatus] = useState("Check GitHub for the latest QUINN release.");
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [verifiedSha256, setVerifiedSha256] = useState("");

  const checkUpdates = async () => {
    setBusy(true);
    setStatus("Checking the latest release…");
    setRelease(null);
    setDownloaded(false);
    try {
      if (!android) throw new Error("The native updater is available in the Android app.");

      const [app, response] = await Promise.all([
        QuinnUpdater.getAppInfo(),
        fetch(RELEASE_API, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
        }),
      ]);

      setCurrentVersion(app.version);
      if (!response.ok) throw new Error(`GitHub release lookup failed (HTTP ${response.status}).`);

      const latest = await response.json() as Release;
      if (!latest.tag_name || !Array.isArray(latest.assets)) {
        throw new Error("GitHub returned an invalid release record.");
      }

      const apk = latest.assets.find(asset =>
        asset.name === `QUINN-Android-${latest.tag_name}.apk`
      );
      const checksum = latest.assets.find(asset =>
        asset.name === `QUINN-Android-${latest.tag_name}.apk.sha256`
      );

      if (!apk || !checksum) {
        throw new Error("This release is missing its Android APK or SHA-256 checksum.");
      }
      if (!trustedReleaseUrl(apk.browser_download_url) ||
          !trustedReleaseUrl(checksum.browser_download_url)) {
        throw new Error("The release contains an untrusted download address.");
      }

      setRelease(latest);
      setApkName(apk.name);
      const newer = isNewer(latest.tag_name, app.version);
      setAvailable(newer);
      setStatus(newer
        ? `QUINN ${latest.tag_name} is available.`
        : `You have the latest version (${app.version}).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Update check failed.");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!release || !apkName) return;
    setBusy(true);
    setStatus("Downloading and verifying the Android update…");
    try {
      const apk = release.assets.find(asset => asset.name === apkName);
      const checksum = release.assets.find(asset => asset.name === `${apkName}.sha256`);
      if (!apk || !checksum) throw new Error("Release assets are no longer available.");

      const result = await QuinnUpdater.downloadUpdate({
        url: apk.browser_download_url,
        checksumUrl: checksum.browser_download_url,
        fileName: apkName,
      });
      setVerifiedSha256(result.sha256);
      setDownloaded(true);
      setStatus(`Verified SHA-256. Download complete (${(result.bytes / 1048576).toFixed(1)} MB).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Download or verification failed.");
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    if (!apkName) return;
    setBusy(true);
    try {
      const permission = await QuinnUpdater.canInstallPackages();
      if (!permission.allowed) {
        await QuinnUpdater.openInstallSettings();
        setStatus("Allow QUINN to install unknown apps in Android settings, then return and tap Install again.");
        return;
      }

      if (!/^[a-f0-9]{64}$/i.test(verifiedSha256)) {
        throw new Error("No verified checksum is available. Download the update again.");
      }

      const result = await QuinnUpdater.installUpdate({
        fileName: apkName,
        sha256: verifiedSha256,
      });
      if (result.permissionRequired) {
        await QuinnUpdater.openInstallSettings();
        setStatus("Grant installation permission, return to QUINN, and tap Install again.");
      } else {
        setStatus("Android's installer has opened. Confirm the update there.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not open the installer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5 p-5 text-purple-50">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 p-3">
          <Smartphone className="h-6 w-6 text-cyan-300" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">QUINN App Updates</h2>
          <p className="text-xs text-purple-300/70">Android release channel</p>
        </div>
      </div>

      <div className="rounded-xl border border-purple-400/20 bg-black/20 p-4">
        <p className="text-xs uppercase tracking-widest text-purple-300/70">Installed version</p>
        <p className="mt-1 text-xl font-semibold">{currentVersion || "Not checked"}</p>
        <p className="mt-3 text-sm text-purple-200/80" aria-live="polite">{status}</p>
      </div>

      {!android && (
        <p className="text-sm text-amber-200">
          App installation updates are supported on Android. Windows continues to use its existing Electron updater.
        </p>
      )}

      <button
        type="button"
        disabled={busy || !android}
        onClick={checkUpdates}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-40"
      >
        <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        Check for updates
      </button>

      {available && release && (
        <div className="space-y-3 rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-4">
          <div className="flex items-center gap-2 text-cyan-200">
            <Download className="h-5 w-5" />
            <span className="font-semibold">{release.name || release.tag_name}</span>
          </div>
          <p className="whitespace-pre-wrap text-xs leading-5 text-purple-200/80">
            {release.body?.trim() || "No release notes were provided."}
          </p>
          <a
            href={release.html_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cyan-200 underline"
          >
            View GitHub release <ExternalLink className="h-3 w-3" />
          </a>
          {!downloaded ? (
            <button
              type="button"
              disabled={busy}
              onClick={download}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> Download and verify update
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={install}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-40"
            >
              <ShieldCheck className="h-4 w-4" /> Install verified update
            </button>
          )}
        </div>
      )}

      <p className="text-[11px] leading-5 text-purple-300/60">
        Updates are downloaded from GitHub and checked against their published SHA-256 checksum.
        Android displays its own installation confirmation. QUINN cannot silently install APKs.
      </p>
    </section>
  );
}
