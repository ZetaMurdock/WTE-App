// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpListener;

// Desktop Google sign-in (loopback flow): open the system browser to Google's
// consent screen, capture the redirect on 127.0.0.1, exchange the code (PKCE)
// for an OpenID id_token, and hand it back to the webview for Firebase
// signInWithCredential. PKCE verifier/challenge are generated in the webview.
fn google_signin_blocking(
    client_id: String,
    client_secret: String,
    code_challenge: String,
    code_verifier: String,
) -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{}", port);

    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&code_challenge={}&code_challenge_method=S256&prompt=select_account",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect),
        urlencoding::encode("openid email profile"),
        urlencoding::encode(&code_challenge),
    );
    open::that(&url).map_err(|e| e.to_string())?;

    let mut code = String::new();
    for stream in listener.incoming() {
        let mut s = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut buf = [0u8; 4096];
        let n = s.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let path = req
            .lines()
            .next()
            .unwrap_or("")
            .split_whitespace()
            .nth(1)
            .unwrap_or("")
            .to_string();

        let body = "<html><body style=\"font-family:sans-serif;background:#1b1815;color:#e7e2d8;text-align:center;padding-top:80px\"><h2>W.T.E &mdash; signed in</h2><p>You can close this tab and return to the app.</p></body></html>";
        let _ = s.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .as_bytes(),
        );

        if let Some(i) = path.find("code=") {
            let raw = path[i + 5..].split('&').next().unwrap_or("").to_string();
            code = urlencoding::decode(&raw).map(|c| c.into_owned()).unwrap_or(raw);
            if !code.is_empty() {
                break;
            }
        }
        if path.contains("error=") {
            return Err("Sign-in was cancelled or denied".into());
        }
    }
    if code.is_empty() {
        return Err("No authorization code received".into());
    }

    let resp = ureq::post("https://oauth2.googleapis.com/token")
        .send_form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code_verifier", code_verifier.as_str()),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect.as_str()),
        ])
        .map_err(|e| format!("token exchange failed: {}", e))?;
    let v: serde_json::Value = resp.into_json().map_err(|e| e.to_string())?;
    v.get("id_token")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "no id_token in response".to_string())
}

#[tauri::command]
async fn google_signin(
    client_id: String,
    client_secret: String,
    code_challenge: String,
    code_verifier: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        google_signin_blocking(client_id, client_secret, code_challenge, code_verifier)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![google_signin])
        .run(tauri::generate_context!())
        .expect("error while running W.T.E application");
}
