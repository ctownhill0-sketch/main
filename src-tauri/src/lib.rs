mod commands;
mod geocoding;
mod keychain;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::has_api_key,
            commands::validate_and_store_api_key,
            commands::remove_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
