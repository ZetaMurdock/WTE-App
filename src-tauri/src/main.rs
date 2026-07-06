// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::Manager;

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

    let resp = match ureq::post("https://oauth2.googleapis.com/token").send_form(&[
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("code_verifier", code_verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect.as_str()),
    ]) {
        Ok(r) => r,
        // surface Google's real error body (e.g. invalid_client / redirect_uri_mismatch)
        Err(ureq::Error::Status(code, r)) => {
            let body = r.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| {
                    let e = v.get("error").and_then(|x| x.as_str()).unwrap_or("");
                    let d = v.get("error_description").and_then(|x| x.as_str()).unwrap_or("");
                    if e.is_empty() { None } else { Some(format!("{} — {}", e, d)) }
                })
                .unwrap_or(body);
            return Err(format!("Google rejected the token exchange ({}): {}", code, msg));
        }
        Err(e) => return Err(format!("token exchange failed: {}", e)),
    };
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

fn get_rules_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. App Data custom rules (only if it contains at least one markdown rules file)
    if let Ok(app_data) = app.path().app_data_dir() {
        let custom_rules = app_data.join("rules");
        if custom_rules.exists() && custom_rules.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&custom_rules) {
                let has_files = entries.filter_map(|e| e.ok()).any(|e| {
                    e.path().is_file() && e.path().extension().and_then(|s| s.to_str()) == Some("md")
                });
                if has_files {
                    return Ok(custom_rules);
                }
            }
        }
    }
    
    // 2. Bundled resource rules
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled_rules = res_dir.join("rules");
        if bundled_rules.exists() {
            return Ok(bundled_rules);
        }
    }
    
    // 3. Dev mode relative fallbacks
    if let Ok(curr_dir) = std::env::current_dir() {
        let dev_rules1 = curr_dir.join("src").join("rules");
        if dev_rules1.exists() {
            return Ok(dev_rules1);
        }
        let dev_rules2 = curr_dir.join("..").join("src").join("rules");
        if dev_rules2.exists() {
            return Ok(dev_rules2);
        }
    }
    
    // 4. Default fallback: create in App Data
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let custom_rules = app_data.join("rules");
    std::fs::create_dir_all(&custom_rules).map_err(|e| e.to_string())?;
    Ok(custom_rules)
}

#[derive(Serialize)]
struct SearchResult {
    title: String,
    url: String,
    snippet: String,
    score: i32,
}

#[tauri::command]
async fn wte_search(app: tauri::AppHandle, query: String) -> Result<Vec<SearchResult>, String> {
    let rules_dir = get_rules_dir(&app)?;
    if !rules_dir.exists() {
        return Ok(Vec::new());
    }
    
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    
    let entries = std::fs::read_dir(rules_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
            let filename = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let title = filename.replace('_', " ");
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            
            let mut score = 0;
            let title_lower = title.to_lowercase();
            let content_lower = content.to_lowercase();
            
            if title_lower == query_lower {
                score += 150;
            } else if title_lower.contains(&query_lower) {
                score += 80;
            }
            
            let matches_count = content_lower.matches(&query_lower).count();
            score += (matches_count * 10) as i32;
            
            if score > 0 {
                let snippet = if let Some(idx) = content_lower.find(&query_lower) {
                    let start = idx.saturating_sub(60);
                    let end = std::cmp::min(content.len(), idx + query_lower.len() + 60);
                    let mut text = content[start..end].replace('\n', " ");
                    if start > 0 {
                        text = format!("...{}", text);
                    }
                    if end < content.len() {
                        text = format!("{}...", text);
                    }
                    text
                } else {
                    let limit = std::cmp::min(content.len(), 120);
                    let mut text = content[..limit].replace('\n', " ");
                    if content.len() > 120 {
                        text = format!("{}...", text);
                    }
                    text
                };
                
                results.push(SearchResult {
                    title,
                    url: format!("wte://rules/{}", filename),
                    snippet,
                    score,
                });
            }
        }
    }
    
    results.sort_by(|a, b| b.score.cmp(&a.score));
    Ok(results)
}

#[tauri::command]
async fn wte_load_page(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let rules_dir = get_rules_dir(&app)?;
    let clean_stem = Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid page reference".to_string())?;
    
    let file_path = rules_dir.join(clean_stem).with_extension("md");
    if !file_path.exists() {
        return Err(format!("Page not found: {}", clean_stem));
    }
    
    std::fs::read_to_string(&file_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn wte_import_zip(app: tauri::AppHandle, zip_path: String) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let custom_rules_dir = app_data.join("rules");
    std::fs::create_dir_all(&custom_rules_dir).map_err(|e| e.to_string())?;
    
    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    
    let mut count = 0;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = match file.enclosed_name() {
            Some(path) => {
                if let Some(filename) = path.file_name() {
                    custom_rules_dir.join(filename)
                } else {
                    continue;
                }
            }
            None => continue,
        };

        if file.name().ends_with('/') {
            continue;
        } else {
            let mut outfile = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    
    Ok(format!("Successfully imported {} rule files.", count))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![
            google_signin,
            wte_search,
            wte_load_page,
            wte_import_zip
        ])
        .run(tauri::generate_context!())
        .expect("error while running W.T.E application");
}
