# Code signing & notarization runbook

LeadScout currently ships **unsigned** builds — you told us you have neither an Apple
Developer account nor a Windows code-signing certificate yet. This doc is what to do
once you get either. Nothing below is wired into the repo automatically; you'll add
the config/secrets described here when you're ready.

Verify current bundler config in `src-tauri/tauri.conf.json` (`bundle.targets: "all"`,
icons already in `src-tauri/icons/`) before starting either flow — that part is done.

## macOS (primary target)

### 1. Get an Apple Developer account

Enroll at https://developer.apple.com/programs/ ($99/year). You need a
**Developer ID Application** certificate specifically (not a Mac App Store
certificate) since LeadScout is distributed outside the App Store.

### 2. Create and install the signing certificate

1. In Xcode: Settings → Accounts → your Apple ID → Manage Certificates → **+** →
   "Developer ID Application". Xcode installs it into your login keychain.
2. Confirm it's there: `security find-identity -v -p codesigning` should list
   `Developer ID Application: Your Name (TEAMID)`.

### 3. Create an App Store Connect API key (for notarization)

1. https://appstoreconnect.apple.com/access/integrations/api → generate a key with
   the **Developer** role. Download the `.p8` file once (Apple won't let you
   re-download it) and note the Key ID and Issuer ID.

### 4. Configure Tauri to sign and notarize

Add to `src-tauri/tauri.conf.json` under `bundle.macOS`:

```json
"macOS": {
  "signingIdentity": "Developer ID Application: Your Name (TEAMID)"
}
```

Set these environment variables before building (never commit them):

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_KEY="<Key ID>"
export APPLE_API_ISSUER="<Issuer ID>"
export APPLE_API_KEY_PATH="/path/to/AuthKey_<KeyID>.p8"
```

### 5. Build, sign, and notarize

```bash
pnpm tauri build
```

With the identity and API key env vars set, Tauri's bundler signs the `.app`,
staples a notarization ticket automatically, and produces a signed `.dmg`. If it
doesn't staple automatically for your Tauri version, do it manually:

```bash
xcrun notarytool submit path/to/LeadScout.dmg \
  --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" \
  --wait
xcrun stapler staple path/to/LeadScout.dmg
```

### 6. Verify

```bash
spctl -a -vv path/to/LeadScout.app   # should say "accepted", "source=Notarized Developer ID"
```

## Windows (secondary target)

### 1. Get a code-signing certificate

An **OV** (Organization Validation) cert is cheaper but still triggers a SmartScreen
warning until your binary builds enough reputation; an **EV** (Extended Validation)
cert avoids SmartScreen immediately but requires a hardware token and costs more.
Buy from any Microsoft-trusted CA (DigiCert, SSL.com, etc.).

### 2. Configure Tauri

Add to `src-tauri/tauri.conf.json` under `bundle.windows`:

```json
"windows": {
  "certificateThumbprint": "<thumbprint from your cert>",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com"
}
```

An EV cert on a hardware token needs the token plugged in and its middleware
installed at build time; an OV cert installed in the Windows certificate store just
needs the thumbprint above (`certutil -store My` to find it).

### 3. Build

```bash
pnpm tauri build
```

Tauri invokes `signtool` automatically when `certificateThumbprint` is set.

### 4. Verify

Right-click the `.msi`/`.exe` → Properties → Digital Signatures tab should show your
organization as the signer.

## Auto-updater (not yet wired up)

The spec calls for Tauri's built-in updater. Signing and notarization above are
prerequisites for it (an unsigned update won't install cleanly on either OS), and it
additionally needs:

1. An update-signing keypair: `pnpm tauri signer generate -w ~/.tauri/leadscout.key`.
2. An `updater` entry in `tauri.conf.json` pointing at a JSON endpoint you host,
   listing the latest version/download URLs/signature.
3. Somewhere to host that JSON + the signed binaries (GitHub Releases works well and
   is free).

This isn't set up yet because it needs a hosting decision from you (where releases
live) — everything else in this runbook is a prerequisite for it, so do those first.
