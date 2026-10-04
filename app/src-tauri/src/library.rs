//! Boards that aren't tied to a project yet ("library" boards) live in the app's
//! data folder, one folder per board: <library>/<slug>/.board/. They use the
//! exact same layout as project boards, so everything else works unchanged,
//! and a board can be moved into a project once there is one.

use std::{
    fs, io,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use crate::{BOARD_DIR, BOARD_FILE, LOCK_FILE};

const MAX_BOARD_BYTES: u64 = 20 * 1024 * 1024;

/// `BOARD_LIBRARY` overrides the location (portable installs, tests).
pub fn library_dir(app_data: Option<PathBuf>) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::var_os("BOARD_LIBRARY").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    app_data.map(|d| d.join("boards")).ok_or_else(|| "Couldn't find the app data folder".into())
}

/// Slugs come from the UI (shared slugify); still, never trust them as path components.
pub fn valid_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 40
        && slug.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !slug.starts_with('-')
}

/// Creates `<library>/<slug>` (or `<slug>-2`, `-3`, … if taken) with an empty board layout.
pub fn create(library: &Path, slug: &str) -> Result<PathBuf, String> {
    if !valid_slug(slug) {
        return Err("Invalid board name".into());
    }
    fs::create_dir_all(library).map_err(|e| e.to_string())?;
    for n in 1..1000 {
        let name = if n == 1 { slug.to_string() } else { format!("{slug}-{n}") };
        let root = library.join(&name);
        match fs::create_dir(&root) {
            Ok(()) => {
                fs::create_dir_all(root.join(BOARD_DIR).join(crate::ASSETS_DIR)).map_err(|e| e.to_string())?;
                return Ok(root);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Too many boards with that name".into())
}

#[derive(Serialize, Debug)]
pub struct Entry {
    pub root: String,
    pub slug: String,
    pub title: Option<String>,
    pub items: usize,
    /// Seconds since the epoch, from board.json's modification time.
    pub modified: u64,
}

/// Library boards, most recently changed first. Unreadable entries are skipped.
pub fn list(library: &Path) -> Vec<Entry> {
    let Ok(dirs) = fs::read_dir(library) else { return Vec::new() };
    let mut out: Vec<Entry> = dirs
        .filter_map(Result::ok)
        .filter(|d| d.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|d| {
            let root = d.path();
            let file = root.join(BOARD_DIR).join(BOARD_FILE);
            let meta = fs::metadata(&file).ok().filter(|m| m.len() <= MAX_BOARD_BYTES);
            let json: Option<serde_json::Value> =
                meta.as_ref().and_then(|_| fs::read_to_string(&file).ok()).and_then(|t| serde_json::from_str(&t).ok());
            if json.is_none() && !root.join(BOARD_DIR).is_dir() {
                return None; // not a board folder
            }
            let title = json.as_ref().and_then(|v| v.get("title")?.as_str()).map(|s| s.chars().take(80).collect());
            let items = json.as_ref().and_then(|v| v.get("items")?.as_array().map(Vec::len)).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            Some(Entry {
                root: root.to_string_lossy().into_owned(),
                slug: d.file_name().to_string_lossy().into_owned(),
                title,
                items,
                modified,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

/// True if `root` is a board folder directly inside the library.
pub fn contains(library: &Path, root: &Path) -> bool {
    let canon = |p: &Path| fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    root.parent().is_some_and(|parent| canon(parent) == canon(library))
}

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &to)?;
        } else if ty.is_file() && entry.file_name() != LOCK_FILE {
            fs::copy(entry.path(), &to)?;
        }
        // Symlinks are skipped on purpose: a board never needs them.
    }
    Ok(())
}

/// Moves a library board to the Recycle Bin / Trash (recoverable; never a
/// permanent delete). Only folders directly inside the library that hold a
/// board are accepted, so this can't be pointed at anything else on disk.
pub fn trash_board(library: &Path, root: &Path) -> Result<(), String> {
    if !contains(library, root) || !root.join(BOARD_DIR).is_dir() {
        return Err("Only boards in Board's own library can be deleted here".into());
    }
    trash::delete(root).map_err(|e| format!("Couldn't move the board to the Recycle Bin: {e}"))
}

/// Moves `<from>/.board` to `<to>/.board`, then removes the emptied `from` folder.
/// Refuses if the destination already has a board. Falls back to copy + delete
/// when a plain rename can't work (different drives).
pub fn move_board(from: &Path, to: &Path) -> Result<(), String> {
    if !to.is_dir() {
        return Err("That folder doesn't exist".into());
    }
    let src = from.join(BOARD_DIR);
    let dst = to.join(BOARD_DIR);
    if dst.exists() {
        return Err("That folder already has a board. Open it instead, or pick another folder.".into());
    }
    if fs::rename(&src, &dst).is_err() {
        if let Err(e) = copy_dir_all(&src, &dst) {
            let _ = fs::remove_dir_all(&dst);
            return Err(format!("Couldn't move the board: {e}"));
        }
        fs::remove_dir_all(&src).map_err(|e| format!("Board copied, but the old copy couldn't be removed: {e}"))?;
    }
    let _ = fs::remove_file(dst.join(LOCK_FILE));
    // Only removes `from` if nothing else is in it (it's normally empty now).
    let _ = fs::remove_dir(from);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("board-lib-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn slugs_cannot_escape_the_library() {
        for ok in ["mood", "neon-alley-2", "a1"] {
            assert!(valid_slug(ok), "{ok}");
        }
        for bad in ["", "..", "../x", "a/b", "a\\b", "C:", "Upper", "-lead", "with space", &"x".repeat(41)] {
            assert!(!valid_slug(bad), "{bad}");
        }
    }

    #[test]
    fn creates_unique_folders_and_lists_them() {
        let lib = temp("create");
        let a = create(&lib, "mood").unwrap();
        let b = create(&lib, "mood").unwrap();
        assert!(a.ends_with("mood") && b.ends_with("mood-2"));
        fs::write(a.join(BOARD_DIR).join(BOARD_FILE), r#"{"title":"Mood","items":[{},{}]}"#).unwrap();
        fs::create_dir_all(lib.join("not-a-board")).unwrap();
        let entries = list(&lib);
        assert_eq!(entries.len(), 2);
        let mood = entries.iter().find(|e| e.slug == "mood").unwrap();
        assert_eq!((mood.title.as_deref(), mood.items), (Some("Mood"), 2));
        assert!(contains(&lib, &a));
        assert!(!contains(&lib, &lib));
        fs::remove_dir_all(&lib).unwrap();
    }

    #[test]
    fn moves_into_a_project_and_refuses_to_overwrite() {
        let lib = temp("move-lib");
        let project = temp("move-project");
        let from = create(&lib, "idea").unwrap();
        fs::write(from.join(BOARD_DIR).join(BOARD_FILE), "{}").unwrap();
        fs::write(from.join(BOARD_DIR).join("assets").join("a.png"), b"png").unwrap();
        fs::write(from.join(BOARD_DIR).join(LOCK_FILE), "1").unwrap();

        move_board(&from, &project).unwrap();
        assert!(project.join(BOARD_DIR).join(BOARD_FILE).exists());
        assert!(project.join(BOARD_DIR).join("assets").join("a.png").exists());
        assert!(!project.join(BOARD_DIR).join(LOCK_FILE).exists());
        assert!(!from.exists(), "library folder should be gone");

        let other = create(&lib, "other").unwrap();
        assert!(move_board(&other, &project).is_err(), "must not overwrite an existing board");
        assert!(other.join(BOARD_DIR).exists(), "source untouched after refusal");

        // Only library boards can be trashed; a folder outside the library is refused.
        assert!(trash_board(&lib, &project).is_err());
        assert!(trash_board(&lib, &lib).is_err());

        // Cross-drive fallback path.
        let project2 = temp("move-project-2");
        copy_dir_all(&other.join(BOARD_DIR), &project2.join(BOARD_DIR)).unwrap();
        assert!(project2.join(BOARD_DIR).join("assets").is_dir());

        for d in [lib, project, project2] {
            fs::remove_dir_all(d).unwrap();
        }
    }
}
