//! Safe reading and writing of agent configuration files.

use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use crate::{Error, Result};

/// Reads a config file, returning `None` when it does not exist.
pub(crate) fn read_optional(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(None),
        Err(source) => Err(io_error(path, source)),
    }
}

/// Path of the backup kept next to `path` before AgentDeck overwrites it.
pub fn backup_path(path: &Path) -> PathBuf {
    with_suffix(path, ".agentdeck.bak")
}

/// Replaces the content of `path` atomically, after copying the previous
/// version to [`backup_path`]. A crash mid-write never leaves a truncated
/// config behind.
pub(crate) fn write(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| io_error(parent, source))?;
    }
    if path.exists() {
        let backup = backup_path(path);
        fs::copy(path, &backup).map_err(|source| io_error(&backup, source))?;
    }
    let tmp = with_suffix(path, ".agentdeck.tmp");
    fs::write(&tmp, content).map_err(|source| io_error(&tmp, source))?;
    fs::rename(&tmp, path).map_err(|source| io_error(path, source))
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = OsString::from(path.file_name().unwrap_or_default());
    name.push(suffix);
    path.with_file_name(name)
}

fn io_error(path: &Path, source: std::io::Error) -> Error {
    Error::Io {
        path: path.to_path_buf(),
        source,
    }
}
