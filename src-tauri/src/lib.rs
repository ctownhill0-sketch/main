mod commands;
mod db;
mod enrichment;
mod geocoding;
mod keychain;
mod pipeline;
mod places;
mod quadtree;
mod robots;
mod saved_searches;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(commands::DeepSearchRegistry::default())
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

                let qps = places::cost::get_setting_f64(&pool, "rate_limit_qps", 5.0)
                    .await
                    .unwrap_or(5.0);
                handle.manage(places::PlacesClient::new(qps));

                handle.manage(db::AppDb(pool));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::has_api_key,
            commands::validate_and_store_api_key,
            commands::remove_api_key,
            commands::quick_search,
            commands::list_places,
            commands::fetch_place_details,
            commands::start_deep_search,
            commands::cancel_deep_search,
            commands::add_lead,
            commands::remove_lead,
            commands::update_lead_status,
            commands::update_lead_notes,
            commands::list_leads,
            commands::list_tags,
            commands::create_tag,
            commands::set_lead_tags,
            commands::get_lead_statuses,
            commands::set_lead_statuses,
            commands::save_search,
            commands::list_saved_searches,
            commands::delete_saved_search,
            commands::run_saved_search,
            commands::enrich_lead_emails,
            commands::list_lead_emails,
            commands::get_spend_summary,
            commands::set_spend_caps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
