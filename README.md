# LeadScout

A desktop lead-generation app on the official Google Places API (New) — Tauri v2 +
React/TypeScript, with built-in cost guardrails and Google Maps Platform Terms
compliance. See [CLAUDE.md](./CLAUDE.md) for the field-mask/cost/compliance rules
every contributor should know before touching the Places client, and
[DESIGN.md](./DESIGN.md) for the design system.

## Prerequisites

- Node.js 20+ and [pnpm](https://pnpm.io/)
- Rust (via [rustup](https://rustup.rs/))
- Platform build tools — see https://v2.tauri.app/start/prerequisites/, or just run:
  ```bash
  pnpm check-prereqs
  ```
  which prints exact install steps for your OS if anything is missing.

## Development

```bash
pnpm install
pnpm tauri dev
```

## Testing

```bash
pnpm typecheck              # TypeScript
cd src-tauri && cargo test  # Rust — includes the mask-guard test; run this
                             # before pushing any change to a field mask
```

## Building

```bash
pnpm tauri build
```

Produces platform-appropriate installers under `src-tauri/target/release/bundle/`.
Builds are **unsigned** by default — see [docs/SIGNING.md](./docs/SIGNING.md) for the
macOS notarization and Windows code-signing runbooks.

## First run

You'll need a Google Places API key with the Places API and Geocoding API enabled.
The app validates it with one cheap Geocoding call on first launch and stores it in
your OS keychain — never in the app's database or in plaintext.
