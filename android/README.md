# EditalRadar Android

Android shell built in Kotlin around the existing Vite/React web app.

- UI/feature logic: React + JavaScript/TypeScript in the main app.
- Native Android container: Kotlin + Android WebView.
- Backend/auth/data: existing Supabase services.
- APK is built automatically by GitHub Actions and uploaded as an Actions artifact.

The APK requires internet access. It loads the production site at https://editalradar-gamma.vercel.app/.
Email/password sign-in is available in the web app. Google OAuth inside an embedded WebView may be restricted by Google; use the web version in Chrome for Google sign-in if it fails.

To build locally with Android SDK and Gradle installed:
```sh
cd android
gradle assembleDebug
```
The APK output is `android/app/build/outputs/apk/debug/app-debug.apk`.
