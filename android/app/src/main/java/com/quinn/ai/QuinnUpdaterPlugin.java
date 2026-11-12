package com.quinn.ai;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "QuinnUpdater")
public class QuinnUpdaterPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private static final String[] ALLOWED_HOSTS = {
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
        "github-releases.githubusercontent.com"
    };

    private boolean allowedHost(String host) {
        if (host == null) return false;
        for (String allowed : ALLOWED_HOSTS) {
            if (allowed.equalsIgnoreCase(host)) return true;
        }
        return false;
    }

    private HttpURLConnection trustedConnection(String address) throws Exception {
        URL current = new URL(address);
        if (!"https".equalsIgnoreCase(current.getProtocol()) ||
            !"github.com".equalsIgnoreCase(current.getHost())) {
            throw new SecurityException("Update URL must originate from GitHub.");
        }

        for (int redirects = 0; redirects < 6; redirects++) {
            HttpURLConnection connection =
                (HttpURLConnection) current.openConnection();
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "QUINN-AI-Android-Updater");

            int status = connection.getResponseCode();
            if (status >= 200 && status < 300) {
                if (!"https".equalsIgnoreCase(connection.getURL().getProtocol()) ||
                    !allowedHost(connection.getURL().getHost())) {
                    connection.disconnect();
                    throw new SecurityException("Untrusted GitHub download host.");
                }
                return connection;
            }

            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new Exception("Missing redirect location.");
                current = new URL(current, location);
                if (!"https".equalsIgnoreCase(current.getProtocol()) ||
                    !allowedHost(current.getHost())) {
                    throw new SecurityException("Update redirected to an untrusted host.");
                }
                continue;
            }

            connection.disconnect();
            throw new Exception("GitHub download failed: HTTP " + status);
        }

        throw new Exception("Too many download redirects.");
    }

    private String readChecksum(String address) throws Exception {
        HttpURLConnection connection = trustedConnection(address);
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(connection.getInputStream()))) {
            String line = reader.readLine();
            if (line == null) throw new Exception("Empty checksum file.");
            String checksum = line.trim().split("\\s+")[0].toLowerCase(Locale.ROOT);
            if (!checksum.matches("[a-f0-9]{64}")) {
                throw new Exception("Invalid SHA-256 checksum format.");
            }
            return checksum;
        } finally {
            connection.disconnect();
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[32768];
            int count;
            while ((count = input.read(buffer)) != -1) {
                digest.update(buffer, 0, count);
            }
        }

        StringBuilder output = new StringBuilder();
        for (byte value : digest.digest()) {
            output.append(String.format(Locale.ROOT, "%02x", value));
        }
        return output.toString();
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("version", info.versionName == null ? "0.0.0" : info.versionName);
            result.put("platform", "android");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not read installed app version.", error);
        }
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String apkUrl = call.getString("url");
        String checksumUrl = call.getString("checksumUrl");
        String fileName = call.getString("fileName");

        if (apkUrl == null || checksumUrl == null || fileName == null ||
            !fileName.matches("QUINN-Android-[A-Za-z0-9._-]+\\.apk")) {
            call.reject("Invalid update download details.");
            return;
        }

        executor.execute(() -> {
            File temporary = null;
            try {
                String expected = readChecksum(checksumUrl);
                HttpURLConnection connection = trustedConnection(apkUrl);

                File directory = new File(getContext().getCacheDir(), "updates");
                if (!directory.exists() && !directory.mkdirs()) {
                    throw new Exception("Could not create update cache.");
                }

                temporary = new File(directory, fileName + ".download");
                File destination = new File(directory, fileName);

                long total = 0;
                try (InputStream input = connection.getInputStream();
                     FileOutputStream output = new FileOutputStream(temporary)) {
                    byte[] buffer = new byte[32768];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > 500L * 1024L * 1024L) {
                            throw new Exception("APK exceeds the 500 MB safety limit.");
                        }
                        output.write(buffer, 0, count);
                    }
                    output.getFD().sync();
                } finally {
                    connection.disconnect();
                }

                if (total == 0) throw new Exception("Downloaded APK is empty.");

                String actual = sha256(temporary);
                if (!expected.equals(actual)) {
                    throw new SecurityException("APK SHA-256 verification failed.");
                }

                if (destination.exists() && !destination.delete()) {
                    throw new Exception("Could not replace cached update.");
                }
                if (!temporary.renameTo(destination)) {
                    throw new Exception("Could not save verified APK.");
                }

                JSObject result = new JSObject();
                result.put("fileName", fileName);
                result.put("sha256", actual);
                result.put("bytes", total);
                call.resolve(result);
            } catch (Exception error) {
                if (temporary != null && temporary.exists()) temporary.delete();
                call.reject(error.getMessage() == null ? "Update download failed." : error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        boolean allowed = Build.VERSION.SDK_INT < 26 ||
            getContext().getPackageManager().canRequestPackageInstalls();
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
                getActivity().startActivity(intent);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open Android installation settings.", error);
        }
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String fileName = call.getString("fileName");
        String expectedSha256 = call.getString("sha256");

        if (fileName == null ||
            !fileName.matches("QUINN-Android-[A-Za-z0-9._-]+\\.apk") ||
            expectedSha256 == null ||
            !expectedSha256.matches("(?i)[a-f0-9]{64}")) {
            call.reject("Invalid update file or checksum.");
            return;
        }

        try {
            if (Build.VERSION.SDK_INT >= 26 &&
                !getContext().getPackageManager().canRequestPackageInstalls()) {
                JSObject result = new JSObject();
                result.put("permissionRequired", true);
                call.resolve(result);
                return;
            }

            File apk = new File(
                new File(getContext().getCacheDir(), "updates"), fileName
            );
            if (!apk.isFile() || apk.length() == 0) {
                call.reject("Verified update APK was not found. Download it again.");
                return;
            }

            // Re-verify the cached APK immediately before opening the installer.
            String actualSha256 = sha256(apk);
            if (!MessageDigest.isEqual(
                    actualSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                    expectedSha256.toLowerCase(Locale.ROOT).getBytes(
                        java.nio.charset.StandardCharsets.US_ASCII))) {
                apk.delete();
                call.reject("APK integrity check failed. The cached update was deleted.");
                return;
            }

            Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject result = new JSObject();
            result.put("permissionRequired", false);
            result.put("installerOpened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not open Android package installer.", error);
        }
    }
}
