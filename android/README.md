# Bite & Brew — Android app

A full-screen Android app around the café website. On first launch it asks for the café's web
address (or offers a built-in demo with sample data), remembers it, and opens it every time.
All business data stays on the café server; the app stores only that address.

- Works on Android 7.0 and newer (phones and tablets).
- `http://` addresses (café Wi-Fi server, e.g. `192.168.1.20:4000`) and `https://` addresses
  (hosted website) are both supported.
- Keeps the screen awake (tills), saves report downloads to the Downloads folder, lets you pick
  photos for menu items, and shows an OFFLINE page with Retry / Change address when the server
  cannot be reached.
- Back button: goes back inside the app; at the first page it offers Stay / Change café address / Exit.

## Install on a phone (sideloading)
1. Copy `bite-and-brew.apk` to the phone (WhatsApp, Google Drive, USB, email…).
2. Tap the file. If Android asks, allow **Install unknown apps** for the app you opened it from.
3. Open **Bite & Brew**, enter the café address (or tap **Try the demo**).

## Build it yourself
Needs JDK 17+, the Android SDK (platform `android-34`, build-tools 34 or newer) and a signing key:

```bash
keytool -genkeypair -keystore bitebrew-release.jks -alias bitebrew -keyalg RSA -keysize 2048 -validity 10950
ANDROID_HOME=/path/to/sdk BUILD_TOOLS=36.0.0 BB_KEYSTORE=bitebrew-release.jks BB_KEYSTORE_PASSWORD=... ./build-apk.sh
# → build/bite-and-brew.apk
```

Keep the keystore and its password safe and **never commit them**: the same key is required to
publish updates (including to the Play Store). Pages bundled in the app: `app/src/main/assets/`
(`demo.html` is regenerated with `node scripts/build-online-demo.mjs`).

## Not yet verified
Built and signature-checked, but **not run on a physical phone or emulator** in the development
environment. Test on a real device before relying on it.
