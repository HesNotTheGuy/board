//! Desktop shell for Board. Owns all disk access so the webview never gets
//! broad filesystem permissions: it can only read/write the open project's
//! `.board/` folder through the commands below and the `board://` protocol.
//! Every image is sanitized (sanitize.rs) before it is stored, and web
//! downloads go through an SSRF guard (fetch.rs).

use std::{
    borrow::Cow,
    fs,
    io::{ErrorKind, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime},
};

mod fetch;
mod library;
mod sanitize;
mod settings;
#[cfg(windows)]
mod window_style;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{
    http::{header, Response, StatusCode},
    ipc::{InvokeBody, Request},
    AppHandle, Emitter, Manager, State,
};

// Keep in sync with packages/format/src/types.ts.
const BOARD_DIR: &str = ".board";
const BOARD_FILE: &str = "board.json";
const ASSETS_DIR: &str = "assets";
const LOCK_FILE: &str = "board.lock";

const LOCK_TIMEOUT: Duration = Duration::from_secs(3);
const LOCK_STALE: Duration = Duration::from_secs(10);

#[derive(Default)]
struct AppState {
    session: Mutex<Option<Session>>,
}

struct Session {
    root: PathBuf,
    // Dropping the watcher stops it, so it lives as long as the session.
    _watcher: RecommendedWatcher,
}

fn board_dir(state: &AppState) -> Result<PathBuf, String> {
    state
        .session
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map(|s| s.root.join(BOARD_DIR))
        .ok_or_else(|| "No board is open".into())
}

/// Cross-process lock shared with the MCP server (exclusive-create of board.lock).
struct LockGuard(PathBuf);

impl Drop for LockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn acquire_lock(dir: &Path) -> Result<LockGuard, String> {
    let path = dir.join(LOCK_FILE);
    let started = Instant::now();
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                let _ = write!(f, "{}", std::process::id());
                return Ok(LockGuard(path));
            }
            // PermissionDenied happens on Windows while the other side is deleting the file.
            Err(e) if matches!(e.kind(), ErrorKind::AlreadyExists | ErrorKind::PermissionDenied) => {
                let stale = fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .map(|t| SystemTime::now().duration_since(t).unwrap_or_default() > LOCK_STALE)
                    .unwrap_or(false);
                if stale {
                    let _ = fs::remove_file(&path);
                    continue;
                }
                if started.elapsed() > LOCK_TIMEOUT {
                    return Err("The board is locked by another process".into());
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(format!(".tmp-{}", std::process::id()));
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    let mut attempt = 0;
    loop {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            // Windows refuses to replace a file someone has open for a moment.
            Err(_) if attempt < 20 => {
                attempt += 1;
                thread::sleep(Duration::from_millis(20));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp);
                return Err(e.to_string());
            }
        }
    }
}

fn disk_rev(text: &str) -> u64 {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|v| v.get("rev").and_then(|r| r.as_u64()))
        .unwrap_or(0)
}

/// A folder passed on the command line (`board <folder>`), if any.
#[tauri::command]
fn launch_root() -> Option<String> {
    std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.is_dir())
        .and_then(|p| std::path::absolute(p).ok())
        .map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize)]
struct OpenResult {
    json: Option<String>,
    name: String,
    /// A standalone board in the app's library rather than inside a project folder.
    library: bool,
}

fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    library::library_dir(app.path().app_data_dir().ok())
}

fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    settings::settings_path(app.path().app_data_dir().ok())
}

#[tauri::command(async)]
fn get_settings(app: AppHandle) -> Result<settings::Settings, String> {
    Ok(settings::load(&settings_file(&app)?))
}

/// Off by default. The MCP server reads this before every call.
#[tauri::command(async)]
fn set_mcp_access(app: AppHandle, mode: settings::McpAccess) -> Result<(), String> {
    let path = settings_file(&app)?;
    let mut current = settings::load(&path);
    current.mcp_access = mode;
    settings::save(&path, &current)
}

/// Starts a board with no project: a new folder in the library. Returns its root.
#[tauri::command(async)]
fn create_board(app: AppHandle, slug: String) -> Result<String, String> {
    let root = library::create(&library_dir(&app)?, &slug)?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn list_library(app: AppHandle) -> Result<Vec<library::Entry>, String> {
    Ok(library::list(&library_dir(&app)?))
}

/// Sends a library board to the Recycle Bin. If it's the open board, closes it first
/// (stops watching it) so nothing writes to it afterwards. Returns whether it was open.
#[tauri::command(async)]
fn delete_board(app: AppHandle, state: State<'_, AppState>, root: String) -> Result<bool, String> {
    let root = PathBuf::from(root);
    // The same folder can arrive spelled differently (slashes, case); compare resolved paths.
    let canon = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let target = canon(&root);
    let was_open = {
        let mut session = state.session.lock().map_err(|e| e.to_string())?;
        let open = session.as_ref().is_some_and(|s| canon(&s.root) == target);
        if open {
            *session = None;
        }
        open
    };
    library::trash_board(&library_dir(&app)?, &root)?;
    Ok(was_open)
}

/// Moves the open library board into a project folder and returns the new root.
/// The caller reopens it there.
#[tauri::command(async)]
fn move_board(app: AppHandle, state: State<'_, AppState>, target: String) -> Result<String, String> {
    let from = {
        let session = state.session.lock().map_err(|e| e.to_string())?;
        session.as_ref().map(|s| s.root.clone()).ok_or("No board is open")?
    };
    if !library::contains(&library_dir(&app)?, &from) {
        return Err("Only boards that aren't in a project yet can be moved".into());
    }
    let to = PathBuf::from(target);
    let dir = from.join(BOARD_DIR);
    // Hold the board lock so no agent writes mid-move, and stop watching the old location.
    let lock = acquire_lock(&dir)?;
    *state.session.lock().map_err(|e| e.to_string())? = None;
    std::mem::forget(lock); // the lock file moves with the board and is deleted there
    if let Err(e) = library::move_board(&from, &to) {
        let _ = fs::remove_file(dir.join(LOCK_FILE));
        return Err(e);
    }
    Ok(to.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn open_board(app: AppHandle, state: State<'_, AppState>, root: String) -> Result<OpenResult, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err("That folder doesn't exist".into());
    }
    let dir = root.join(BOARD_DIR);
    fs::create_dir_all(dir.join(ASSETS_DIR)).map_err(|e| e.to_string())?;

    let emitter = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        let relevant = matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_))
            && event.paths.iter().any(|p| p.file_name().is_some_and(|n| n == BOARD_FILE));
        if relevant {
            let _ = emitter.emit("board:changed", ());
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&dir, RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;

    let json = fs::read_to_string(dir.join(BOARD_FILE)).ok();
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "board".into());
    let library = library_dir(&app).is_ok_and(|lib| library::contains(&lib, &root));
    *state.session.lock().map_err(|e| e.to_string())? = Some(Session { root, _watcher: watcher });
    Ok(OpenResult { json, name, library })
}

#[tauri::command(async)]
fn read_board(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let dir = board_dir(&state)?;
    Ok(fs::read_to_string(dir.join(BOARD_FILE)).ok())
}

#[derive(Serialize)]
struct SaveResult {
    ok: bool,
    /// On conflict, the newer board on disk for the caller to merge with.
    disk: Option<String>,
}

/// Compare-and-swap write: succeeds only if the board on disk is still at `base_rev`.
#[tauri::command(async)]
fn save_board(state: State<'_, AppState>, json: String, base_rev: u64) -> Result<SaveResult, String> {
    let dir = board_dir(&state)?;
    let _lock = acquire_lock(&dir)?;
    let path = dir.join(BOARD_FILE);
    if let Ok(current) = fs::read_to_string(&path) {
        if disk_rev(&current) != base_rev {
            return Ok(SaveResult { ok: false, disk: Some(current) });
        }
    }
    write_atomic(&path, json.as_bytes())?;
    Ok(SaveResult { ok: true, disk: None })
}

#[derive(Serialize)]
struct Imported {
    asset: String,
    width: u32,
    height: u32,
    source: Option<String>,
}

/// Sanitizes untrusted image bytes and stores the clean copy content-addressed.
fn store_clean(state: &AppState, bytes: &[u8], source: Option<String>) -> Result<Imported, String> {
    let clean = sanitize::sanitize(bytes)?;
    let dir = board_dir(state)?.join(ASSETS_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let hex: String = Sha256::digest(&clean.bytes).iter().take(8).map(|b| format!("{b:02x}")).collect();
    let name = format!("{hex}.{}", clean.ext);
    let path = dir.join(&name);
    if !path.exists() {
        write_atomic(&path, &clean.bytes)?;
    }
    Ok(Imported { asset: format!("{ASSETS_DIR}/{name}"), width: clean.width, height: clean.height, source })
}

/// Pasted or dropped image bytes (raw request body).
#[tauri::command(async)]
fn import_asset(state: State<'_, AppState>, request: Request<'_>) -> Result<Imported, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw image bytes".into());
    };
    store_clean(&state, bytes, None)
}

/// An image dragged in from a web page, by URL. See fetch.rs for the guard rails.
#[tauri::command]
async fn fetch_image(state: State<'_, AppState>, url: String) -> Result<Imported, String> {
    let downloaded = fetch::download(&url).await?;
    store_clean(&state, &downloaded.bytes, Some(downloaded.source))
}

/// Turns a `board://` request path into `assets/<file>`, refusing anything that
/// could escape the assets folder (`..`, absolute paths, drive prefixes).
fn asset_rel_path(uri_path: &str) -> Option<PathBuf> {
    let decoded = percent_encoding::percent_decode_str(uri_path.trim_start_matches('/'))
        .decode_utf8()
        .ok()?
        .replace('\\', "/");
    let rel = PathBuf::from(decoded);
    let mut parts = rel.components();
    if parts.next() != Some(Component::Normal(ASSETS_DIR.as_ref())) {
        return None;
    }
    let rest: Vec<_> = parts.collect();
    if rest.is_empty() || !rest.iter().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(rel)
}

/// Maps a `board://` request onto the open board's assets folder.
fn resolve_asset(state: &AppState, uri_path: &str) -> Option<PathBuf> {
    Some(board_dir(state).ok()?.join(asset_rel_path(uri_path)?))
}

/// Only image types are ever served. Anything else in assets/ (say, an .html planted in a
/// cloned repo's board) gets a 404 instead of being rendered by the webview.
fn mime_for(path: &Path) -> Option<&'static str> {
    match path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => Some("image/png"),
        Some("jpg" | "jpeg") => Some("image/jpeg"),
        Some("gif") => Some("image/gif"),
        Some("webp") => Some("image/webp"),
        Some("bmp") => Some("image/bmp"),
        _ => None,
    }
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Cow::Borrowed(&b""[..]))
        .expect("static response")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            // Our own title bar replaces the OS one on Windows (see tauri.windows.conf.json).
            #[cfg(windows)]
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(hwnd) = win.hwnd() {
                    window_style::quiet_border(hwnd.0 as isize);
                }
            }
            #[cfg(not(windows))]
            let _ = app;
            Ok(())
        })
        .register_uri_scheme_protocol("board", |ctx, request| {
            let state = ctx.app_handle().state::<AppState>();
            let Some(path) = resolve_asset(&state, request.uri().path()) else {
                return not_found();
            };
            let Some(mime) = mime_for(&path) else {
                return not_found();
            };
            match fs::read(&path) {
                Ok(bytes) => Response::builder()
                    .header(header::CONTENT_TYPE, mime)
                    .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                    // Assets are content-addressed, so they never change.
                    .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
                    .body(Cow::Owned(bytes))
                    .unwrap_or_else(|_| not_found()),
                Err(_) => not_found(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            launch_root,
            get_settings,
            set_mcp_access,
            create_board,
            delete_board,
            list_library,
            move_board,
            open_board,
            read_board,
            save_board,
            import_asset,
            fetch_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Board");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_paths_stay_inside_assets() {
        let ok = |p: &str| asset_rel_path(p).map(|r| r.to_string_lossy().replace('\\', "/"));
        assert_eq!(ok("/assets%2F3f2a9c01d4e5b6a7.png").as_deref(), Some("assets/3f2a9c01d4e5b6a7.png"));
        assert_eq!(ok("/assets/abc.webp").as_deref(), Some("assets/abc.webp"));
        for bad in [
            "/board.json",
            "/assets",
            "/assets%2F..%2Fboard.json",
            "/assets%5C..%5C..%5Csecret.txt",
            "/%2E%2E%2Fassets%2Fx.png",
            "/assets/../../x.png",
            "/C:%2FWindows%2Fwin.ini",
            "/%2Fetc%2Fpasswd",
        ] {
            assert_eq!(asset_rel_path(bad), None, "should reject {bad}");
        }
    }

    #[test]
    fn reads_rev_from_board_json() {
        assert_eq!(disk_rev(r#"{"format":1,"rev":42,"items":[]}"#), 42);
        assert_eq!(disk_rev("not json"), 0);
    }

    #[test]
    fn lock_is_exclusive_and_released_on_drop() {
        let dir = std::env::temp_dir().join(format!("board-lock-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        {
            let _held = acquire_lock(&dir).unwrap();
            assert!(dir.join(LOCK_FILE).exists());
            // A second writer must wait; with the lock held it times out instead of barging in.
            assert!(acquire_lock(&dir).is_err());
        }
        assert!(!dir.join(LOCK_FILE).exists());
        write_atomic(&dir.join(BOARD_FILE), br#"{"rev":1}"#).unwrap();
        assert_eq!(disk_rev(&fs::read_to_string(dir.join(BOARD_FILE)).unwrap()), 1);
        fs::remove_dir_all(&dir).unwrap();
    }
}
