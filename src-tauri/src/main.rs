// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
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

// Rules are resolved as an OVERLAY: App Data custom rules (imported updates) take priority
// per-file, but bundled/dev pages that were not overridden stay reachable. This means a
// partial rulebook update zip (e.g. just Home.md) no longer hides every other page.
fn get_rules_dirs(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    // 1. App Data custom rules — highest priority (imported updates)
    if let Ok(app_data) = app.path().app_data_dir() {
        let custom_rules = app_data.join("rules");
        if custom_rules.is_dir() {
            dirs.push(custom_rules);
        }
    }
    // 2. Bundled resource rules
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled_rules = res_dir.join("rules");
        if bundled_rules.is_dir() {
            dirs.push(bundled_rules);
        }
    }
    // 3. Dev mode relative fallbacks
    if let Ok(curr_dir) = std::env::current_dir() {
        for cand in [curr_dir.join("src").join("rules"), curr_dir.join("..").join("src").join("rules")] {
            if cand.is_dir() {
                dirs.push(cand);
            }
        }
    }
    dirs
}

// Every .md rules file across the overlay, first (highest-priority) hit per name wins.
fn collect_rule_files(app: &tauri::AppHandle) -> Vec<(String, PathBuf)> {
    let mut seen = std::collections::HashSet::new();
    let mut files = Vec::new();
    for dir in get_rules_dirs(app) {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("md") {
                    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                        if seen.insert(stem.to_lowercase()) {
                            files.push((stem.to_string(), path));
                        }
                    }
                }
            }
        }
    }
    files
}

// Wiki titles like "Anima: Envy" or "Equipment/Armor" must become valid Windows filenames
// (and Firebase keys). Applied consistently at save AND lookup so wte://rules/<title> works.
fn sanitize_stem(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '#' | '$' | '[' | ']' | '.' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

#[tauri::command]
async fn wte_save_page(app: tauri::AppHandle, name: String, content: String) -> Result<String, String> {
    let stem = sanitize_stem(&name);
    if stem.is_empty() {
        return Err("Invalid page name".into());
    }
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let rules_dir = app_data.join("rules");
    std::fs::create_dir_all(&rules_dir).map_err(|e| e.to_string())?;
    let file_path = rules_dir.join(&stem).with_extension("md");
    std::fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(stem)
}

#[tauri::command]
async fn wte_delete_page(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let stem = sanitize_stem(&name);
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let file_path = app_data.join("rules").join(&stem).with_extension("md");
    if !file_path.exists() {
        return Err("No local copy of that page exists".into());
    }
    std::fs::remove_file(&file_path).map_err(|e| e.to_string())
}

// Mirrored pages are HTML-heavy — strip tags so search scoring & snippets read the text.
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

#[tauri::command]
async fn wte_list_pages(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut names: Vec<String> = collect_rule_files(&app).into_iter().map(|(n, _)| n).collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http(s) links may be opened externally".into());
    }
    open::that(&url).map_err(|e| e.to_string())
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
    let query_lower = query.to_lowercase();
    let mut results = Vec::new();

    // clamp byte offsets to char boundaries — wiki text is full of multibyte chars (— ’ ·)
    fn floor_char(s: &str, mut i: usize) -> usize { while i > 0 && !s.is_char_boundary(i) { i -= 1; } i }
    fn ceil_char(s: &str, mut i: usize) -> usize { while i < s.len() && !s.is_char_boundary(i) { i += 1; } i }

    for (filename, path) in collect_rule_files(&app) {
        {
            let title = filename.replace('_', " ");
            let content = strip_tags(&std::fs::read_to_string(&path).unwrap_or_default());

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
                    let start = floor_char(&content, idx.saturating_sub(60));
                    let end = ceil_char(&content, std::cmp::min(content.len(), idx + query_lower.len() + 60));
                    let mut text = content[start..end].split_whitespace().collect::<Vec<_>>().join(" ");
                    if start > 0 {
                        text = format!("...{}", text);
                    }
                    if end < content.len() {
                        text = format!("{}...", text);
                    }
                    text
                } else {
                    let limit = ceil_char(&content, std::cmp::min(content.len(), 120));
                    let mut text = content[..limit].split_whitespace().collect::<Vec<_>>().join(" ");
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
    // Take the whole reference (titles may contain / like "Equipment/Armor" — Path::file_stem
    // would wrongly strip the prefix) and sanitize it exactly like wte_save_page does, so
    // wte://rules/Anima:_Envy finds the sanitized Anima__Envy.md on disk.
    let raw = path.trim();
    let clean_stem = raw.strip_suffix(".md").unwrap_or(raw);
    if clean_stem.is_empty() {
        return Err("Invalid page reference".to_string());
    }

    let want = sanitize_stem(clean_stem).to_lowercase();
    for (stem, file_path) in collect_rule_files(&app) {
        if sanitize_stem(&stem).to_lowercase() == want {
            return std::fs::read_to_string(&file_path).map_err(|e| e.to_string());
        }
    }
    Err(format!("Page not found: {}", clean_stem))
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

// Phase 4 schema. Campaign-scoped tables; entity fields not yet fully modelled ride in
// a JSON `data` column (a bridge for the Phase 5/6 rebuilds). All IF NOT EXISTS so the
// migration is safe to re-run.
const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  name TEXT NOT NULL,
  data TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS encounters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  name TEXT NOT NULL,
  scene_id TEXT,
  data TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  uri TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  title TEXT,
  body TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rules_meta (
  stem TEXT PRIMARY KEY,
  title TEXT,
  source TEXT,
  campaign_id TEXT,
  updated_at INTEGER NOT NULL
);
";

fn main() {
    let migrations = vec![tauri_plugin_sql::Migration {
        version: 1,
        description: "create core campaign-scoped tables",
        sql: SCHEMA_V1,
        kind: tauri_plugin_sql::MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:wte.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            google_signin,
            wte_search,
            wte_load_page,
            wte_import_zip,
            wte_list_pages,
            wte_save_page,
            wte_delete_page,
            open_external
        ])
        .run(tauri::generate_context!())
        .expect("error while running W.T.E application");
}
