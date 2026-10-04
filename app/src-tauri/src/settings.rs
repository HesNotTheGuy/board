//! User settings shared with the MCP server: a small JSON file in the app's data
//! folder. The MCP server re-reads it on every call, so a change applies at once.
//! It fails closed: a missing or unreadable file means MCP access is off.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

/// What MCP clients (AI tools) may do with the user's boards.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum McpAccess {
    #[default]
    Off,
    /// Look only: overview, view, list boards.
    Read,
    /// Look and add: also add, caption, remove their own items, create boards.
    Write,
}

#[derive(Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub mcp_access: McpAccess,
}

/// `BOARD_SETTINGS` overrides the location (tests, portable installs).
pub fn settings_path(app_data: Option<PathBuf>) -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("BOARD_SETTINGS").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(p));
    }
    app_data.map(|d| d.join("settings.json")).ok_or_else(|| "Couldn't find the app data folder".into())
}

pub fn load(path: &Path) -> Settings {
    fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(path: &Path, settings: &Settings) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    crate::write_atomic(path, json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_access_is_off_unless_explicitly_enabled() {
        let dir = std::env::temp_dir().join(format!("board-settings-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("settings.json");
        assert_eq!(load(&path).mcp_access, McpAccess::Off, "missing file");

        fs::create_dir_all(&dir).unwrap();
        for garbage in ["not json", r#"{"mcpAccess":"banana"}"#, r#"{"mcpAccess":1}"#] {
            fs::write(&path, garbage).unwrap();
            assert_eq!(load(&path).mcp_access, McpAccess::Off, "{garbage}");
        }

        save(&path, &Settings { mcp_access: McpAccess::Read }).unwrap();
        assert!(fs::read_to_string(&path).unwrap().contains(r#""mcpAccess": "read""#));
        assert_eq!(load(&path).mcp_access, McpAccess::Read);
        fs::remove_dir_all(&dir).unwrap();
    }
}
