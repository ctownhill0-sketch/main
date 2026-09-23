//! User-editable lead-gen search presets, stored as plain JSON in the OS
//! app-data directory (not SQLite — this is a small, user-editable config
//! file, not query-able data) at `<app_data_dir>/presets.json`. Lazily
//! seeded from the bundled default set on first read. Read/written via
//! plain `std::fs` here on the Rust side, not `@tauri-apps/plugin-fs` — that
//! plugin only gates frontend-initiated fs calls, so a Rust-side command
//! using `std::fs` needs no capability/ACL entry.
//!
//! `filters` records a preset's suggested Refine-bar starting state (see
//! the Results page's Refine bar) — Commit 4 (this file) only applies a
//! preset's `types`/`suggestedRadiusMeters` to the search form; wiring
//! `filters` into the Refine bar's initial state happens once that bar
//! exists.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const DEFAULT_PRESETS_JSON: &str = include_str!("../presets/default_presets.json");
const PRESETS_FILENAME: &str = "presets.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetFilters {
    pub has_website: Option<bool>,
    pub max_rating: Option<f64>,
    pub max_review_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub types: Vec<String>,
    pub suggested_radius_meters: Option<u32>,
    pub description: String,
    #[serde(default)]
    pub filters: Option<PresetFilters>,
}

#[derive(Debug, thiserror::Error)]
pub enum PresetsError {
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("stored presets are corrupt: {0}")]
    Corrupt(#[from] serde_json::Error),
}

fn presets_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(PRESETS_FILENAME)
}

/// Reads `<app_data_dir>/presets.json`, seeding it from the bundled default
/// set first if it doesn't exist yet.
pub fn load_presets(app_data_dir: &Path) -> Result<Vec<Preset>, PresetsError> {
    let path = presets_path(app_data_dir);
    if !path.exists() {
        fs::create_dir_all(app_data_dir)?;
        fs::write(&path, DEFAULT_PRESETS_JSON)?;
    }
    let contents = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&contents)?)
}

fn write_presets(app_data_dir: &Path, presets: &[Preset]) -> Result<(), PresetsError> {
    let json = serde_json::to_string_pretty(presets)?;
    fs::write(presets_path(app_data_dir), json)?;
    Ok(())
}

/// Inserts a new preset or replaces an existing one with the same `id`
/// (read-modify-write over the small JSON file — no concurrent-writer
/// concerns for a single-user desktop app).
pub fn save_preset(app_data_dir: &Path, preset: Preset) -> Result<(), PresetsError> {
    let mut presets = load_presets(app_data_dir)?;
    match presets.iter_mut().find(|p| p.id == preset.id) {
        Some(existing) => *existing = preset,
        None => presets.push(preset),
    }
    write_presets(app_data_dir, &presets)
}

pub fn delete_preset(app_data_dir: &Path, id: &str) -> Result<(), PresetsError> {
    let mut presets = load_presets(app_data_dir)?;
    presets.retain(|p| p.id != id);
    write_presets(app_data_dir, &presets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::places::ALL_PLACE_TYPES;

    /// A fresh temp dir per test, avoiding a `tempfile` dev-dependency —
    /// matches this codebase's minimal-dependency convention.
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("leadscout_test_presets_{}_{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn every_bundled_preset_type_exists_in_all_place_types() {
        let presets: Vec<Preset> = serde_json::from_str(DEFAULT_PRESETS_JSON).unwrap();
        assert!(!presets.is_empty());
        for preset in &presets {
            for t in &preset.types {
                assert!(
                    ALL_PLACE_TYPES.iter().any(|p| p.value == t),
                    "preset '{}' references unknown type '{}'",
                    preset.name,
                    t
                );
            }
        }
    }

    #[test]
    fn ten_presets_are_bundled() {
        let presets: Vec<Preset> = serde_json::from_str(DEFAULT_PRESETS_JSON).unwrap();
        assert_eq!(presets.len(), 10);
    }

    #[test]
    fn loading_seeds_the_default_presets_on_first_run() {
        let dir = temp_dir("seed");
        let presets = load_presets(&dir).unwrap();
        assert_eq!(presets.len(), 10);
        assert!(dir.join(PRESETS_FILENAME).exists());
    }

    #[test]
    fn save_then_list_then_delete_round_trips() {
        let dir = temp_dir("crud");
        load_presets(&dir).unwrap(); // seed

        let custom = Preset {
            id: "custom-1".to_string(),
            name: "My Preset".to_string(),
            types: vec!["cafe".to_string()],
            suggested_radius_meters: Some(5000),
            description: "test".to_string(),
            filters: None,
        };
        save_preset(&dir, custom.clone()).unwrap();
        let presets = load_presets(&dir).unwrap();
        assert!(presets.iter().any(|p| p.id == "custom-1"));
        assert_eq!(presets.len(), 11);

        // Saving again with the same id replaces, doesn't duplicate.
        save_preset(&dir, custom).unwrap();
        let presets = load_presets(&dir).unwrap();
        assert_eq!(presets.len(), 11);

        delete_preset(&dir, "custom-1").unwrap();
        let presets = load_presets(&dir).unwrap();
        assert!(!presets.iter().any(|p| p.id == "custom-1"));
        assert_eq!(presets.len(), 10);
    }
}
