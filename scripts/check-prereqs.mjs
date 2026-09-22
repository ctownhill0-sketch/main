#!/usr/bin/env node
// Checks that the Rust toolchain and platform-specific Tauri build
// dependencies are present, and prints exact install steps when they
// are missing. Run automatically before `pnpm tauri dev` / `pnpm tauri build`.
import { execFileSync } from "node:child_process";
import { platform } from "node:os";

function has(cmd, args = ["--version"]) {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pkgConfigHas(pkg) {
  try {
    execFileSync("pkg-config", ["--exists", pkg]);
    return true;
  } catch {
    return false;
  }
}

const os = platform();
const missing = [];

if (!has("rustc")) missing.push("rustc");
if (!has("cargo")) missing.push("cargo");

if (os === "darwin") {
  // Xcode Command Line Tools provide the linker/frameworks Tauri needs.
  if (!has("xcode-select", ["-p"])) missing.push("xcode-command-line-tools");
} else if (os === "linux") {
  if (!has("pkg-config")) missing.push("pkg-config");
  if (!pkgConfigHas("webkit2gtk-4.1")) missing.push("webkit2gtk-4.1-dev");
  if (!pkgConfigHas("gtk+-3.0")) missing.push("gtk3-dev");
} else if (os === "win32") {
  // Best-effort: Rust MSVC toolchain + WebView2 runtime (usually preinstalled on Win 10/11).
  if (!has("rustc", ["--version"])) missing.push("rust-msvc-toolchain");
}

if (missing.length === 0) {
  console.log("[check-prereqs] All Tauri build prerequisites found.");
  process.exit(0);
}

console.error("[check-prereqs] Missing prerequisites:", missing.join(", "));
console.error("");

if (os === "darwin") {
  console.error("macOS install steps:");
  console.error("  1. Install Rust:      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh");
  console.error("  2. Install Xcode CLT: xcode-select --install");
} else if (os === "linux") {
  console.error("Linux (Debian/Ubuntu) install steps:");
  console.error("  1. Install Rust:  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh");
  console.error("  2. Install libs:  sudo apt-get update && sudo apt-get install -y \\");
  console.error("       libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \\");
  console.error("       librsvg2-dev patchelf build-essential curl wget file libssl-dev pkg-config");
  console.error("  (Fedora/Arch: see https://v2.tauri.app/start/prerequisites/ for equivalents.)");
} else if (os === "win32") {
  console.error("Windows install steps:");
  console.error("  1. Install Rust (MSVC toolchain): https://rustup.rs");
  console.error("  2. Install 'Desktop development with C++' via Visual Studio Build Tools:");
  console.error("     https://visualstudio.microsoft.com/visual-cpp-build-tools/");
  console.error("  3. Install the WebView2 runtime (preinstalled on most Win 10/11):");
  console.error("     https://developer.microsoft.com/microsoft-edge/webview2/");
}

console.error("");
console.error("Full reference: https://v2.tauri.app/start/prerequisites/");
process.exit(1);
