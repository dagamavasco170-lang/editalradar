#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE não está definido pelo GitHub Actions}"
: "${RUNNER_TEMP:?RUNNER_TEMP não está definido pelo GitHub Actions}"

APP_ID="br.com.editalradar.app"
RELEASE_READY="${RELEASE_READY:-false}"
APP_VERSION="${APP_VERSION:-}"
VERSION_CODE="${VERSION_CODE:-}"

echo "Dispositivo conectado:"
adb get-state

if [[ "$RELEASE_READY" == "true" ]]; then
  : "${APP_VERSION:?APP_VERSION é obrigatório para testar uma release assinada}"
  : "${VERSION_CODE:?VERSION_CODE é obrigatório para testar uma release assinada}"

  CURRENT_APK="$GITHUB_WORKSPACE/release-assets/EditalRadar-Android-v${APP_VERSION}.apk"
  RELEASE_CHECKSUMS="$GITHUB_WORKSPACE/release-assets/SHA256SUMS.txt"
  test -s "$CURRENT_APK"
  test -s "$RELEASE_CHECKSUMS"
  (
    cd "$GITHUB_WORKSPACE/release-assets"
    sha256sum --check SHA256SUMS.txt
  )

  # Seleciona a versão estável imediatamente anterior, não apenas /latest.
  # Isso mantém o fluxo repetível caso a mesma versão seja reexecutada após publicar.
  RELEASES_JSON="$(
    curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
      "https://api.github.com/repos/dagamavasco170-lang/editalradar/releases?per_page=50"
  )"

  RELEASES_FILE="$RUNNER_TEMP/android-releases.json"
  PREVIOUS_INFO_FILE="$RUNNER_TEMP/previous-release-info.txt"
  printf '%s' "$RELEASES_JSON" > "$RELEASES_FILE"
  python3 - "$APP_VERSION" "$RELEASES_FILE" > "$PREVIOUS_INFO_FILE" <<'PY'
import json
import re
import sys

current_version = tuple(int(part) for part in sys.argv[1].split("."))
with open(sys.argv[2], encoding="utf-8") as releases_file:
    releases = json.load(releases_file)
previous_candidates = []

for release in releases:
    if release.get("draft") or release.get("prerelease"):
        continue

    match = re.fullmatch(r"android-v(\d+)\.(\d+)\.(\d+)", release.get("tag_name", ""))
    if match is None:
        continue

    version = tuple(int(part) for part in match.groups())
    if version < current_version:
        previous_candidates.append((version, release))

if not previous_candidates:
    raise SystemExit("A API não retornou uma versão estável anterior à versão em teste.")

_, previous_release = max(previous_candidates, key=lambda item: item[0])
tag = previous_release.get("tag_name", "")
assets = previous_release.get("assets", [])

apk = next(
    (
        item for item in assets
        if item.get("name", "").endswith(".apk")
        and item.get("state") == "uploaded"
    ),
    None,
)
checksums = next(
    (
        item for item in assets
        if item.get("name") == "SHA256SUMS.txt"
        and item.get("state") == "uploaded"
    ),
    None,
)
if apk is None or checksums is None:
    raise SystemExit("A release anterior não possui APK e SHA256SUMS publicados.")

expected_prefix = f"https://github.com/dagamavasco170-lang/editalradar/releases/download/{tag}/"
apk_url = apk.get("browser_download_url", "")
checksums_url = checksums.get("browser_download_url", "")
if not apk_url.startswith(expected_prefix) or not checksums_url.startswith(expected_prefix):
    raise SystemExit("A release anterior contém URLs de download fora do repositório oficial.")

print(tag)
print(apk["name"])
print(apk_url)
print(checksums_url)
PY

  mapfile -t PREVIOUS_INFO < "$PREVIOUS_INFO_FILE"
  if [[ "${#PREVIOUS_INFO[@]}" -ne 4 ]]; then
    echo "Não foi possível ler os metadados da versão anterior."
    exit 1
  fi

  PREVIOUS_TAG="${PREVIOUS_INFO[0]}"
  PREVIOUS_APK_NAME="${PREVIOUS_INFO[1]}"
  PREVIOUS_APK_URL="${PREVIOUS_INFO[2]}"
  PREVIOUS_CHECKSUM_URL="${PREVIOUS_INFO[3]}"
  PREVIOUS_VERSION="${PREVIOUS_TAG#android-v}"

  PREVIOUS_APK="$RUNNER_TEMP/$PREVIOUS_APK_NAME"
  PREVIOUS_CHECKSUMS="$RUNNER_TEMP/previous-SHA256SUMS.txt"

  curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
    "$PREVIOUS_APK_URL" -o "$PREVIOUS_APK"
  curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
    "$PREVIOUS_CHECKSUM_URL" -o "$PREVIOUS_CHECKSUMS"

  EXPECTED_PREVIOUS_HASH="$(
    awk -v name="$PREVIOUS_APK_NAME" '$2 == name || $2 == "*" name { print $1; exit }' \
      "$PREVIOUS_CHECKSUMS"
  )"
  if [[ ! "$EXPECTED_PREVIOUS_HASH" =~ ^[a-fA-F0-9]{64}$ ]]; then
    echo "O checksum da versão estável anterior não foi encontrado."
    exit 1
  fi
  printf '%s  %s\n' "$EXPECTED_PREVIOUS_HASH" "$PREVIOUS_APK" | sha256sum --check -

  echo "Instalando a versão estável anterior: $PREVIOUS_TAG"
  adb install "$PREVIOUS_APK"

  OLD_PACKAGE_INFO="$(adb shell dumpsys package "$APP_ID")"
  if ! printf '%s' "$OLD_PACKAGE_INFO" | grep -Fq "versionName=$PREVIOUS_VERSION"; then
    echo "O emulador não confirmou a instalação da versão anterior $PREVIOUS_VERSION."
    exit 1
  fi

  echo "Atualizando por cima da versão instalada para EditalRadar $APP_VERSION."
  # O Package Manager do Android valida a compatibilidade da assinatura aqui.
  # Uma mudança acidental de certificado causa falha no adb install -r.
  adb install -r "$CURRENT_APK"

  NEW_PACKAGE_INFO="$(adb shell dumpsys package "$APP_ID")"
  if ! printf '%s' "$NEW_PACKAGE_INFO" | grep -Fq "versionName=$APP_VERSION"; then
    echo "O Android não confirmou versionName=$APP_VERSION depois da atualização."
    printf '%s\n' "$NEW_PACKAGE_INFO" | grep -E "versionCode=|versionName=" || true
    exit 1
  fi
  if ! printf '%s' "$NEW_PACKAGE_INFO" | grep -Fq "versionCode=$VERSION_CODE"; then
    echo "O Android não confirmou versionCode=$VERSION_CODE depois da atualização."
    printf '%s\n' "$NEW_PACKAGE_INFO" | grep -E "versionCode=|versionName=" || true
    exit 1
  fi

  echo "Atualização assinada validada: $PREVIOUS_VERSION -> $APP_VERSION."
else
  DEBUG_APK="$GITHUB_WORKSPACE/android/app/build/outputs/apk/debug/app-debug.apk"
  echo "APK de verificação: $DEBUG_APK"
  test -s "$DEBUG_APK"
  adb install -r "$DEBUG_APK"
fi

adb logcat -c
adb shell am force-stop "$APP_ID"
adb shell am start -W -n "$APP_ID/.MainActivity"

for attempt in $(seq 1 30); do
  if adb shell pidof "$APP_ID" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

if ! adb shell pidof "$APP_ID" >/dev/null 2>&1; then
  adb logcat -d -s AndroidRuntime:E
  echo "O processo do EditalRadar não permaneceu ativo após a inicialização."
  exit 1
fi

if ! adb shell dumpsys activity activities | grep -Fq "$APP_ID/.MainActivity"; then
  adb logcat -d -s AndroidRuntime:E
  echo "A MainActivity não foi encontrada na pilha de atividades."
  exit 1
fi

WINDOW_XML_PATH="/sdcard/editalradar-window.xml"
WINDOW_XML=""

# UIAutomator pode retornar temporariamente "null root node" logo depois do
# startActivity. Cada tentativa remove o XML anterior para nunca aceitar uma
# captura antiga como se fosse a tela atual.
capture_window_xml() {
  WINDOW_XML=""
  adb shell rm -f "$WINDOW_XML_PATH" >/dev/null 2>&1 || true

  if ! adb shell uiautomator dump "$WINDOW_XML_PATH" >/dev/null 2>&1; then
    return 1
  fi

  WINDOW_XML="$(adb shell cat "$WINDOW_XML_PATH" 2>/dev/null || true)"
  [[ -n "$WINDOW_XML" ]]
}

echo "Aguardando a interface nativa ficar disponível..."
NATIVE_UI_READY=false
for attempt in $(seq 1 10); do
  if capture_window_xml && printf '%s' "$WINDOW_XML" | grep -Fq "Atualizações"; then
    NATIVE_UI_READY=true
    break
  fi
  sleep 2
done

if [[ "$NATIVE_UI_READY" != "true" ]]; then
  echo "A interface nativa não pôde ser confirmada pelo UIAutomator."
  printf '%s\n' "$WINDOW_XML"
  adb logcat -d -s EditalRadarWebView:W chromium:E WebViewFactory:E AndroidRuntime:E
  exit 1
fi

# Confirma que a WebView realmente abriu o catálogo, e não apenas a moldura
# nativa. A falha transitória do UIAutomator nunca substitui esta verificação.
echo "Aguardando o catálogo principal aparecer na WebView..."
CONTENT_READY=false
for attempt in $(seq 1 24); do
  if capture_window_xml && printf '%s' "$WINDOW_XML" | grep -Eiq "Encontre concursos"; then
    CONTENT_READY=true
    break
  fi
  sleep 5
done

if [[ "$CONTENT_READY" != "true" ]]; then
  echo "O aplicativo iniciou, mas o título principal do catálogo não apareceu na WebView."
  printf '%s\n' "$WINDOW_XML"
  adb logcat -d -s EditalRadarWebView:W chromium:E WebViewFactory:E AndroidRuntime:E
  exit 1
fi

echo "Conteúdo principal do catálogo confirmado na WebView."

if adb logcat -d -s AndroidRuntime:E | grep -Fq "FATAL EXCEPTION"; then
  echo "Foi detectada uma exceção fatal durante a inicialização do EditalRadar."
  adb logcat -d -s AndroidRuntime:E
  exit 1
fi

echo "Teste concluído: instalação/atualização verificada e MainActivity ativa em Android 10."
