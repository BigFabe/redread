#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
JDK_BIN="${JAVA_HOME:+$JAVA_HOME/bin}"
JDK_BIN="${JDK_BIN:-$(dirname "$(readlink -f "$(command -v java)")")}"
export PATH="$JDK_BIN:$PATH"
BUILD_TOOLS="${ANDROID_BUILD_TOOLS:-36.0.0}"
PLATFORM="${ANDROID_PLATFORM:-android-37.0}"
BT="$SDK/build-tools/$BUILD_TOOLS"
ANDROID_JAR="$SDK/platforms/$PLATFORM/android.jar"
# All generated files, including the local development signing key, stay here.
mkdir -p build/classes build/dex build/generated
"$BT/aapt2" compile --dir res -o build/resources.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$ANDROID_JAR" --manifest AndroidManifest.xml -A assets --java build/generated build/resources.zip
find src build/generated -name '*.java' -print > build/sources.txt
javac -source 8 -target 8 -encoding UTF-8 -bootclasspath "$ANDROID_JAR:$BT/core-lambda-stubs.jar" -d build/classes @build/sources.txt
find build/classes -name '*.class' -print > build/classes.txt
"$BT/d8" --min-api 26 --lib "$ANDROID_JAR" --output build/dex @build/classes.txt
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile
with ZipFile('build/unsigned.apk', 'a') as apk:
    for dex in Path('build/dex').glob('*.dex'):
        apk.write(dex, dex.name)
PY
"$BT/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
if [[ ! -f build/debug.keystore ]]; then
    keytool -genkeypair -keystore build/debug.keystore -storepass android -keypass android -alias androiddebugkey -dname 'CN=redread Development' -keyalg RSA -keysize 2048 -validity 10000
fi
"$BT/apksigner" sign --ks build/debug.keystore --ks-pass pass:android --out build/redread.apk build/aligned.apk
"$BT/apksigner" verify build/redread.apk
printf 'APK: %s/build/redread.apk\n' "$PWD"
