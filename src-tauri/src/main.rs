// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use serde::Serialize;
use tauri::Manager;

mod backup;
mod net;

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

/// The ONLY extension W.T.E will write. `.json` was originally allowed too, which
/// was far too broad: any absolute .json path the webview named could be
/// overwritten — a package.json, a tsconfig, an editor's settings.json, another
/// game's save file. A campaign package has its own extension, so nothing is lost
/// by refusing the rest.
const EXPORT_EXTENSION: &str = "wtepack";

fn export_extension_ok(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case(EXPORT_EXTENSION))
        .unwrap_or(false)
}

/// Validate a destination before writing to it. Split out so it is testable
/// without a dialog or a filesystem write.
fn validate_export_path(p: &std::path::Path) -> Result<(), String> {
    if !export_extension_ok(p) {
        return Err(format!("W.T.E only writes .{EXPORT_EXTENSION} files."));
    }
    if !p.is_absolute() || p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Export path must be absolute with no parent-directory segments.".into());
    }
    if p.is_dir() {
        return Err("That path is a folder, not a file.".into());
    }
    if let Ok(meta) = std::fs::symlink_metadata(p) {
        if meta.file_type().is_symlink() {
            return Err("Refusing to write through a symlink.".into());
        }
    }
    match p.parent() {
        Some(parent) if parent.exists() => Ok(()),
        Some(_) => Err("That folder does not exist.".into()),
        None => Err("That path has no folder.".into()),
    }
}

/// Export a campaign package.
///
/// RUST OWNS THE SAVE DIALOG. The webview passes only the CONTENT and a suggested
/// filename — never a path — so there is no path for it to choose, and the
/// destination is by construction one the user confirmed in a native dialog.
///
/// This replaces an earlier version that accepted a path from the webview. Even
/// with validation that was the wrong shape: it made the webview the source of a
/// filesystem destination, and the extension allowlist then had to carry the whole
/// weight of the boundary.
///
/// The fs plugin remains read-only. Granting `fs:allow-write-file` would let any
/// code in the webview write anywhere the user can, which is precisely the blast
/// radius the CSP and sanitizer work reduced.
///
/// Returns the path written, or None when the user cancelled.
#[tauri::command]
async fn wte_export_campaign(
    app: tauri::AppHandle,
    content: String,
    default_name: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Only the FILE NAME is taken from the webview, and only its last component, so
    // a name like "../../etc/passwd" cannot escape the folder the user picks.
    let suggested = std::path::Path::new(&default_name)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("campaign.wtepack")
        .to_string();
    let suggested = if export_extension_ok(std::path::Path::new(&suggested)) {
        suggested
    } else {
        format!("{suggested}.{EXPORT_EXTENSION}")
    };

    let (tx, rx) = std::sync::mpsc::channel::<Option<std::path::PathBuf>>();
    app.dialog()
        .file()
        .add_filter("W.T.E campaign package", &[EXPORT_EXTENSION])
        .set_file_name(&suggested)
        .save_file(move |chosen| {
            let _ = tx.send(chosen.and_then(|p| p.into_path().ok()));
        });

    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten())
        .await
        .map_err(|e| e.to_string())?;

    let Some(path) = picked else { return Ok(None) };
    validate_export_path(&path)?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod export_tests {
    use super::{export_extension_ok, validate_export_path};
    use std::path::Path;

    #[test]
    fn accepts_only_our_own_extension() {
        assert!(export_extension_ok(Path::new("C:/Users/x/Ashen Sun.wtepack")));
        assert!(export_extension_ok(Path::new("C:/Users/x/UPPER.WTEPACK")));
    }

    #[test]
    fn refuses_json_and_everything_else() {
        // .json used to be accepted, which meant any absolute .json path the
        // webview named could be overwritten.
        for bad in [
            "C:/Users/x/backup.json",
            "C:/Users/x/package.json",
            "C:/Users/x/tsconfig.json",
            "C:/Windows/System32/drivers/etc/hosts",
            "C:/Users/x/.bashrc",
            "C:/Users/x/evil.exe",
            "C:/Users/x/evil.bat",
            "C:/Users/x/wte.db",
            "C:/Users/x/noextension",
        ] {
            assert!(!export_extension_ok(Path::new(bad)), "should refuse {bad:?}");
            assert!(validate_export_path(Path::new(bad)).is_err(), "should refuse {bad:?}");
        }
    }

    #[test]
    fn refuses_relative_and_traversing_paths() {
        for bad in ["relative.wtepack", "C:/Users/x/../../evil.wtepack"] {
            assert!(validate_export_path(Path::new(bad)).is_err(), "should refuse {bad:?}");
        }
    }

    #[test]
    fn refuses_a_missing_folder() {
        let p = Path::new("C:/definitely/not/a/real/folder/x.wtepack");
        assert!(validate_export_path(p).is_err());
    }

    #[test]
    fn accepts_a_real_destination() {
        // The system temp dir exists on every platform CI runs on.
        let dir = std::env::temp_dir();
        let p = dir.join("wte-export-test.wtepack");
        assert!(validate_export_path(&p).is_ok(), "temp dir should be writable: {p:?}");
    }
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

/// Characters that must never reach `open::that`.
///
/// On Windows the `open` crate builds `cmd /c start "" "<url>"` and passes the
/// url through `raw_arg` + a `wrap_in_quotes` that only brackets the string
/// without escaping anything inside it (open-5.3.6/src/windows.rs:59). So a
/// double quote in the url closes the wrapper early and everything after it is
/// parsed by cmd.exe as more command line:
///
///     https://a" & calc & "   ->   cmd /c start "" "https://a" & calc & ""
///
/// which runs calc. The scheme check alone does not stop this — the string still
/// begins with "https://". cmd does not expand & or | INSIDE quotes, so the quote
/// is the thing that must be rejected; the rest are refused as cheap insurance.
const URL_FORBIDDEN: &[char] = &['"', '\'', '&', '|', '^', '<', '>', '%', '`', '\n', '\r', '\t', '\0'];

/// True when the string is a plain http(s) url that is safe to hand to the shell.
fn is_safe_external_url(url: &str) -> bool {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return false;
    }
    if url.chars().any(|c| URL_FORBIDDEN.contains(&c)) {
        return false;
    }
    // Any control character, not just the ones named above.
    if url.chars().any(|c| c.is_control()) {
        return false;
    }
    // Must have a non-empty host after the scheme.
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or("");
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || ".-:[]_".contains(c))
}

#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    if !is_safe_external_url(&url) {
        return Err("Only plain http(s) links may be opened externally".into());
    }
    open::that(&url).map_err(|e| e.to_string())
}

#[cfg(test)]
mod url_tests {
    use super::is_safe_external_url;

    #[test]
    fn rejects_the_quote_breakout() {
        // The actual exploit: passes the scheme check, breaks out of cmd's quoting.
        assert!(!is_safe_external_url("https://a\" & calc & \""));
        assert!(!is_safe_external_url("https://x.com/\"&calc&\""));
    }

    #[test]
    fn rejects_shell_metacharacters_and_controls() {
        for bad in [
            "https://x.com/a&b",
            "https://x.com/a|b",
            "https://x.com/a^b",
            "https://x.com/a<b",
            "https://x.com/a>b",
            "https://x.com/a`b",
            "https://x.com/a\nb",
            "https://x.com/a\tb",
            "https://x.com/a%b",
        ] {
            assert!(!is_safe_external_url(bad), "should reject {bad:?}");
        }
    }

    #[test]
    fn rejects_non_http_schemes() {
        for bad in ["javascript:alert(1)", "file:///C:/", "", "ftp://x.com", "//x.com"] {
            assert!(!is_safe_external_url(bad), "should reject {bad:?}");
        }
    }

    #[test]
    fn rejects_a_missing_or_malformed_host() {
        for bad in ["https://", "https:///path", "https://a b.com"] {
            assert!(!is_safe_external_url(bad), "should reject {bad:?}");
        }
    }

    #[test]
    fn allows_ordinary_links() {
        for ok in [
            "https://wonderland-of-the-enigma.fandom.com/wiki/Pressure_Engine",
            "http://localhost:1420/",
            "https://github.com/ZetaMurdock/WTE-App/releases",
            "https://x.com/a/b?c=d#e",
        ] {
            assert!(is_safe_external_url(ok), "should allow {ok:?}");
        }
    }
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

// Phase 5: roll feed. Appended as a new migration — v1 is already applied on 0.4.20
// installs and must never be edited.
const SCHEMA_V2: &str = "
CREATE TABLE IF NOT EXISTS rolls (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  character_id TEXT,
  formula TEXT NOT NULL,
  result INTEGER NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
";

// Codex Remaster slice 4: Sequences (knowledge paths, with embedded Scripts +
// Variables) stored as JSON docs — flexible now, packable/exportable later.
const SCHEMA_V3: &str = "
CREATE TABLE IF NOT EXISTS codex_sequences (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
";

// Codex Remaster slice 5: first-class notes. The v1 notes table gains page
// attachment, GM/player visibility, tags, and an annotated-selection quote.
const SCHEMA_V4: &str = "
ALTER TABLE notes ADD COLUMN attached_to TEXT;
ALTER TABLE notes ADD COLUMN visibility TEXT;
ALTER TABLE notes ADD COLUMN tags TEXT;
ALTER TABLE notes ADD COLUMN quote TEXT;
";

// Phase 2 schema. Registered, and paired with backup_before_schema_upgrade().
//
// Applying this migration makes the database unopenable by any build that only
// knows v1-v4: sqlx validates the applied list against the binary's own, so an
// older W.T.E rejects the database outright — and because getDb once memoized the
// rejected promise, v0.8.60 showed "Loading..." forever with no error. Verified on
// a real 188 MB database during the v0.8.61 pre-release test, which is why the
// schema change was held back out of that release.
//
// It ships now because Phase 2 is where its consumers live, and it ships WITH a
// one-time copy of the database taken before the upgrade. Downgrading is then
// restoring a file rather than a dead end.
//
// campaign_kv is a general scoped store, so a new kind of campaign-scoped blob does
// not need another migration and another table.
//
// rule_layers is deliberately NOT a blob. A campaign rule is one LAYER among
// several — official, content pack, campaign override, character exception,
// temporary session effect — and the resolved value has to be able to explain
// itself ("base 10, +4 Ashen Sun, +2 Voaulton, -1 Null Storm = 15") rather than
// just print a number. That needs each contribution stored separately with its
// source and scope, which a single settings blob cannot express.
/// The schema version this build migrates to. Bumping it arms a fresh backup.
const SCHEMA_VERSION: u32 = 5;

/// Copy the database once, before a schema upgrade it cannot be rolled back from.
///
/// Runs in `setup`, before any JS calls Database::load, so nothing has the file
/// open and a plain copy is consistent. The copying, verification and atomic
/// publication live in `backup.rs`; this only locates the folder and records the
/// verdict where the frontend can find it.
///
/// Keyed on the target version, so each upgrade leaves its own restore point and a
/// later one never overwrites the copy taken before an earlier one.
fn backup_before_schema_upgrade(app: &tauri::AppHandle) -> backup::BackupOutcome {
    let Ok(dir) = app.path().app_data_dir() else {
        return backup::BackupOutcome::Failed("could not locate the W.T.E data folder".into());
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return backup::BackupOutcome::Failed(format!("could not open the W.T.E data folder: {e}"));
    }
    let outcome = backup::run_backup(&dir, SCHEMA_VERSION);
    match &outcome {
        backup::BackupOutcome::Failed(why) => {
            eprintln!("[wte] pre-upgrade backup FAILED, refusing to migrate: {why}")
        }
        other => eprintln!("[wte] pre-upgrade backup: {other:?}"),
    }
    outcome
}

/// The database gate. The frontend asks before it opens the database, and a closed
/// gate means the schema upgrade is not allowed to run.
///
/// This is the piece the old routine lacked: it copied, it failed, it printed to a
/// console nobody reads, and then the migration proceeded anyway. Reporting a
/// failure only matters if something acts on it.
#[derive(Serialize)]
struct MigrationGateReport {
    /// May the app open (and therefore migrate) the database?
    ok: bool,
    /// Present only when it may not. Written for a person, not a log.
    reason: Option<String>,
    /// Where the restore point is — only when one actually exists.
    backup_dir: Option<String>,
    /// False means there is nothing to go back to. Not always a failure (a fresh
    /// install has nothing to preserve) but never guessed at.
    has_restore_point: bool,
    /// Which branch the startup check took, for Diagnostics.
    state: String,
    schema_version: u32,
}

fn gate_report(app: &tauri::AppHandle, outcome: &backup::BackupOutcome) -> MigrationGateReport {
    let dir = app.path().app_data_dir().ok();
    MigrationGateReport {
        ok: outcome.is_safe_to_migrate(),
        reason: outcome.reason(),
        backup_dir: match (outcome.has_restore_point(), dir) {
            (true, Some(d)) => Some(backup::backup_dir(&d, SCHEMA_VERSION).to_string_lossy().into_owned()),
            _ => None,
        },
        has_restore_point: outcome.has_restore_point(),
        state: outcome.label().to_string(),
        schema_version: SCHEMA_VERSION,
    }
}

#[tauri::command]
fn wte_migration_gate(
    app: tauri::AppHandle,
    state: tauri::State<'_, backup::MigrationGate>,
) -> MigrationGateReport {
    let outcome = state
        .0
        .lock()
        .ok()
        .and_then(|g| g.clone())
        // Setup not having run is not a reason to assume the best.
        .unwrap_or_else(|| backup::BackupOutcome::Failed("the startup check did not complete".into()));
    gate_report(&app, &outcome)
}

/// Actually run the backup again.
///
/// "Try again" used to re-read the verdict that was recorded at startup, which
/// could only ever say the same thing — so the button did nothing, and the usual
/// cause (a second W.T.E window, since closed) stayed unfixable without a restart.
#[tauri::command]
fn wte_retry_backup(
    app: tauri::AppHandle,
    state: tauri::State<'_, backup::MigrationGate>,
) -> MigrationGateReport {
    let outcome = backup_before_schema_upgrade(&app);
    if let Ok(mut gate) = state.0.lock() {
        *gate = Some(outcome.clone());
    }
    gate_report(&app, &outcome)
}

const SCHEMA_V5: &str = "
CREATE TABLE IF NOT EXISTS campaign_kv (
  campaign_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (campaign_id, scope, key)
);
CREATE INDEX IF NOT EXISTS idx_campaign_kv_campaign ON campaign_kv (campaign_id);

-- Recreated rather than CREATE IF NOT EXISTS. This migration never shipped: it was
-- written, applied during the v0.8.61 pre-release test, then withdrawn from that
-- release by deleting its _sqlx_migrations record — which leaves the TABLE behind
-- on any machine that ran the test build, without the order_index column added
-- since. CREATE TABLE IF NOT EXISTS would silently keep that older shape.
--
-- Safe to drop because nothing has ever written to rule_layers; campaign_kv is
-- deliberately left alone because it does hold copied rows.
DROP TABLE IF EXISTS rule_layers;
CREATE TABLE rule_layers (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  target_id TEXT NOT NULL,
  layer_scope TEXT NOT NULL,
  owner TEXT,
  op TEXT NOT NULL,
  value TEXT NOT NULL,
  note TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  -- Explicit same-scope sequencing. set/multiply/add are not commutative, so
  -- without this the row order the query happened to return would decide the
  -- mechanics.
  order_index INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rule_layers_target ON rule_layers (campaign_id, target_id);
";

fn main() {
    let migrations = vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "create core campaign-scoped tables",
            sql: SCHEMA_V1,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 2,
            description: "add rolls table",
            sql: SCHEMA_V2,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 3,
            description: "add codex sequences table",
            sql: SCHEMA_V3,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 4,
            description: "extend notes: page attachment, visibility, tags, quote",
            sql: SCHEMA_V4,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        tauri_plugin_sql::Migration {
            version: 5,
            description: "campaign_kv + rule_layers: campaign data and layered rules in the database",
            sql: SCHEMA_V5,
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        // Runs before any JS opens the database, so the copy is taken while nothing
        // holds the file and BEFORE sqlx applies a migration an older build cannot
        // read. Without this, upgrading is a one-way door.
        .setup(|app| {
            let outcome = backup_before_schema_upgrade(&app.handle());
            // Publish the verdict BEFORE the database can be opened. getDb() asks for
            // it and refuses to load when it is Failed, so a backup that did not
            // happen stops the one-way migration instead of merely preceding it.
            if let Ok(mut gate) = app.state::<backup::MigrationGate>().0.lock() {
                *gate = Some(outcome);
            }
            Ok(())
        })
        .manage(backup::MigrationGate::default())
        .manage(net::NetState::default())
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
            wte_export_campaign,
            wte_migration_gate,
            wte_retry_backup,
            open_external,
            net::net_advertise,
            net::net_unadvertise,
            net::net_discovered
        ])
        .run(tauri::generate_context!())
        .expect("error while running W.T.E application");
}
