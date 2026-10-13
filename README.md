# MAVIS AI

Mavis is being rebuilt as a Flutter Android assistant with a premium black-and-blue liquid-glass interface.

## Features
- Floating Mavis hub visible when the app opens
- Chat interface and voice-input entry point
- Voice command entry for “scan and read my screen” with a clear stop control
- Trading analysis UI designed to report buy/sell/wait, entry, stop-loss, take-profit and confidence without placing trades
- GitHub Actions workflow to build and upload a debug APK

## Build
Open the **Actions** tab and run **Build Mavis APK**. Download `mavis-debug-apk` from the completed run's Artifacts section.

Screen reading requires Android accessibility/MediaProjection permissions and is not enabled silently. AI replies require a configured backend/API; no secret keys should be committed to this repository.