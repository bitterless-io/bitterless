# Maestro manual verification gates

The automated parity and Electron baseline are deliberately offline. The following checks require
real credentials, user media, platform packaging, or remote mutation and remain release gates:

- Sign in to production AI-CRMS and Codex/LLM providers; send, stream, abort, and resume a chat.
- Attach and upload a real file, record microphone audio, and exercise the remote ASR path.
- Capture, replay, and inject controls on an authenticated customer page.
- Read and mutate a live integration target: apply mappings, run migrations and schedules, and inspect reports.
- Install/configure the packaged `micromeet` CLI with a live credential and execute approved commands.
- Download and install a real Bitterless update through the Maestro update affordance.
- Smoke-test signed/native packages on macOS arm64/x64, Windows x64, and Linux x64/arm64.

Do not add real credentials or remote writes to `yarn check:maestro` or the Playwright baseline.
