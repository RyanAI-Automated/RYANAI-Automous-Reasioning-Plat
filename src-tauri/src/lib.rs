mod commands;
mod tray;

use commands::{get_hardware_telemetry, trigger_local_agent};
use tray::create_system_tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .setup(|app| {
            create_system_tray(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_hardware_telemetry,
            trigger_local_agent
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
