mod commands;
mod db;
mod geocoding;
mod keychain;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let db_path = handle
                    .path()
                    .app_data_dir()
                    .expect("no app data dir")
                    .join("leadscout.db");

                let pool = db::init_pool(&db_path)
                    .await
                    .expect("failed to initialize database");

                if let Err(e) = db::run_startup_cleanup(&pool).await {
                    eprintln!("startup cache-cleanup job failed: {e}");
                }

                handle.manage(db::AppDb(pool));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::has_api_key,
            commands::validate_and_store_api_key,
            commands::remove_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
