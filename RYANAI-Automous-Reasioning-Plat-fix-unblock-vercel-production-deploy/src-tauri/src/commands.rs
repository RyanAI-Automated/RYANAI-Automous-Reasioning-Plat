use sysinfo::System;
use tauri::command;

#[command]
pub fn get_hardware_telemetry() -> String {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_usage = sys.global_cpu_info().cpu_usage();
    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();

    format!(
        "{{ \"cpu_usage\": {:.2}, \"memory_used\": {}, \"memory_total\": {} }}",
        cpu_usage, memory_used, memory_total
    )
}

#[command]
pub fn trigger_local_agent(prompt: String) -> String {
    format!("Tauri desktop bridge dispatched reasoning task: {}", prompt)
}
