use serde::Serialize;
use sysinfo::System;
use tauri::command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareTelemetry {
    cpu_usage: f32,
    memory_used: u64,
    memory_total: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResponse {
    status: String,
    objective: String,
    result: String,
}

#[command]
pub fn get_hardware_telemetry() -> HardwareTelemetry {
    let mut sys = System::new_all();
    sys.refresh_all();

    HardwareTelemetry {
        cpu_usage: sys.global_cpu_info().cpu_usage(),
        memory_used: sys.used_memory(),
        memory_total: sys.total_memory(),
    }
}

/// Submit an objective to the same local reasoning API used by the web workspace.
#[command]
pub async fn trigger_agent_objective(objective: String) -> Result<AgentResponse, String> {
    let objective = objective.trim().to_owned();
    if objective.is_empty() {
        return Err("A non-empty objective is required.".to_string());
    }

    let base_url = std::env::var("RYANAI_API_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());
    let endpoint = format!("{}/api/reason", base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .post(endpoint)
        .json(&serde_json::json!({ "prompt": objective }))
        .send()
        .await
        .map_err(|error| format!("RyanAI API request failed: {error}"))?;

    let status_code = response.status();
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("RyanAI API returned invalid JSON: {error}"))?;

    let error_message = payload
        .get("error")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("RyanAI API returned HTTP {status_code}"));

    if !status_code.is_success()
        || payload.get("success").and_then(serde_json::Value::as_bool) == Some(false)
    {
        return Err(error_message);
    }

    let result = payload
        .get("output")
        .and_then(serde_json::Value::as_str)
        .or_else(|| payload.get("response").and_then(serde_json::Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_owned();

    if result.is_empty() {
        return Err("RyanAI API returned no reasoning output.".to_string());
    }

    Ok(AgentResponse {
        status: "completed".to_string(),
        objective,
        result,
    })
}
