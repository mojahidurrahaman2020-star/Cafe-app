#!/usr/bin/env bash
# Builds the Bite & Brew Android app (APK) with the Android SDK command-line tools only
# (no Gradle, no downloads). Needs: JDK 17+, Android SDK with platform android-34 and
# build-tools 34, and a signing keystore.
#
#   ANDROID_HOME=/path/to/sdk BB_KEYSTORE=bitebrew-release.jks BB_KEYSTORE_PASSWORD=... ./build-apk.sh
#
# Output: build/bite-and-brew.apk
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
BT="$SDK/build-tools/${BUILD_TOOLS:-34.0.0}"
JAR="$SDK/platforms/android-34/android.jar"
VERSION_NAME="${VERSION_NAME:-1.0.0}"
VERSION_CODE="${VERSION_CODE:-1}"
: "${BB_KEYSTORE:?Set BB_KEYSTORE to the keystore file}"
: "${BB_KEYSTORE_PASSWORD:?Set BB_KEYSTORE_PASSWORD}"

rm -rf build && mkdir -p build/classes
"$BT/aapt2" compile --dir app/src/main/res -o build/res.zip
"$BT/aapt2" link -o build/base.apk -I "$JAR" --manifest app/src/main/AndroidManifest.xml \
  -A app/src/main/assets --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" build/res.zip
javac -source 17 -target 17 -XDstringConcat=inline -Xlint:-options -cp "$JAR" -d build/classes $(find app/src/main/java -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output build $(find build/classes -name '*.class')
cp build/base.apk build/unaligned.apk
(cd build && zip -q -u unaligned.apk classes.dex)
"$BT/zipalign" -f -p 4 build/unaligned.apk build/aligned.apk
"$BT/apksigner" sign --ks "$BB_KEYSTORE" --ks-pass "pass:$BB_KEYSTORE_PASSWORD" --key-pass "pass:$BB_KEYSTORE_PASSWORD" \
  --ks-key-alias "${BB_KEY_ALIAS:-bitebrew}" --out build/bite-and-brew.apk build/aligned.apk
"$BT/apksigner" verify --print-certs build/bite-and-brew.apk | head -3
ls -la build/bite-and-brew.apk
