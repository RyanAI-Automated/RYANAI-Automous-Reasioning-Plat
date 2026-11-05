use serde::Serialize;
use std::net::IpAddr;
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

fn is_loopback_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
        .map(|address| address.is_loopback())
        .unwrap_or(false)
}

/// Build an authenticated reasoning request without persisting or logging the token.
/// Plain HTTP is accepted only for local loopback development.
fn build_reasoning_request(
    base_url: &str,
    objective: &str,
    access_token: &str,
) -> Result<reqwest::Request, String> {
    let objective = objective.trim();
    if objective.is_empty() {
        return Err("A non-empty objective is required.".to_string());
    }

    let access_token = access_token.trim();
    if access_token.is_empty() {
        return Err("Sign in to continue.".to_string());
    }

    let base = reqwest::Url::parse(base_url.trim())
        .map_err(|_| "RyanAI API URL is invalid.".to_string())?;
    let loopback = base.host_str().map(is_loopback_host).unwrap_or(false);
    if base.scheme() != "https" && !loopback {
        return Err("RyanAI API URL must use HTTPS outside loopback development.".to_string());
    }
    if !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("RyanAI API URL must not contain credentials, query parameters or fragments.".to_string());
    }

    let endpoint = base
        .join("/api/reason")
        .map_err(|_| "RyanAI reasoning endpoint is invalid.".to_string())?;

    reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "prompt": objective }))
        .build()
        .map_err(|_| "Could not prepare the RyanAI reasoning request.".to_string())
}

/// Submit an objective to the authenticated reasoning API used by the web workspace.
/// The access token is received from the signed-in frontend session for this request only.
#[command]
pub async fn trigger_agent_objective(
    objective: String,
    access_token: String,
) -> Result<AgentResponse, String> {
    let base_url = std::env::var("RYANAI_API_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3002".to_string());
    let request = build_reasoning_request(&base_url, &objective, &access_token)?;

    let response = reqwest::Client::new()
        .execute(request)
        .await
        .map_err(|error| format!("RyanAI API request failed: {error}"))?;

    let status_code = response.status();
    let payload = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "RyanAI API returned invalid JSON.".to_string())?;

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
        objective: objective.trim().to_string(),
        result,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_a_bearer_authenticated_reasoning_request() {
        let request = build_reasoning_request(
            "http://127.0.0.1:3002",
            "  inspect the service  ",
            " signed-in-session-token ",
        )
        .expect("loopback development request should be valid");

        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.url().as_str(), "http://127.0.0.1:3002/api/reason");
        assert_eq!(
            request.headers().get(reqwest::header::AUTHORIZATION).unwrap(),
            "Bearer signed-in-session-token"
        );

        let body = request.body().and_then(|value| value.as_bytes()).unwrap();
        let payload: serde_json::Value = serde_json::from_slice(body).unwrap();
        assert_eq!(payload["prompt"], "inspect the service");
    }

    #[test]
    fn rejects_missing_session_tokens() {
        let error = build_reasoning_request(
            "https://api.example.test",
            "inspect the service",
            "  ",
        )
        .unwrap_err();

        assert_eq!(error, "Sign in to continue.");
    }

    #[test]
    fn rejects_plain_http_for_non_loopback_hosts() {
        let error = build_reasoning_request(
            "http://api.example.test",
            "inspect the service",
            "signed-in-session-token",
        )
        .unwrap_err();

        assert_eq!(
            error,
            "RyanAI API URL must use HTTPS outside loopback development."
        );
    }

    #[test]
    fn permits_https_api_hosts() {
        let request = build_reasoning_request(
            "https://api.example.test",
            "inspect the service",
            "signed-in-session-token",
        )
        .expect("HTTPS API URL should be valid");

        assert_eq!(request.url().as_str(), "https://api.example.test/api/reason");
    }

    #[test]
    fn rejects_api_urls_with_embedded_credentials() {
        let error = build_reasoning_request(
            "https://user:password@api.example.test",
            "inspect the service",
            "signed-in-session-token",
        )
        .unwrap_err();

        assert_eq!(
            error,
            "RyanAI API URL must not contain credentials, query parameters or fragments."
        );
    }
}
