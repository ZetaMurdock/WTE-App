// Pre-migration database backup.
//
// A schema migration this app cannot undo is only acceptable if going back is a
// matter of restoring files. The first version of this routine did not clear that
// bar: it copied db/wal/shm separately, treated the existence of the main file as
// proof of completion, would permanently skip retrying if the db copied but the WAL
// did not, printed failures to stderr only, and let the migration proceed anyway.
// Every one of those turns a backup into a thing that LOOKS like a backup.
//
// What it does now:
//   - refuses to run while another W.T.E instance could be writing;
//   - copies into a temporary directory, never over the final name;
//   - verifies every component it copied;
//   - publishes completion ATOMICALLY, by renaming the directory into place and
//     only then writing a manifest;
//   - reports failure through a gate the app checks BEFORE opening the database,
//     so a failed backup stops the upgrade instead of preceding it.
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Every file that has to survive together. A database whose WAL was left behind
/// is not the same database.
pub const DB_PARTS: &[&str] = &["wte.db", "wte.db-wal", "wte.db-shm"];

/// SQLite's file magic. A copy that does not start with this is not a database,
/// whatever its size says.
const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";

/// A lock older than this is assumed to belong to a crashed process. The backup
/// itself takes seconds, so minutes of staleness is unambiguous. This is a
/// deliberate trade: checking real PID liveness needs a platform crate, and a
/// stale lock that never expires would wedge the app after any hard kill.
const LOCK_STALE_MS: u128 = 5 * 60 * 1000;

#[derive(Debug, Clone, PartialEq)]
pub enum BackupOutcome {
    /// Nothing to protect — a fresh install with no database yet.
    NothingToDo,
    /// A verified backup for this version already exists.
    AlreadyDone,
    /// Taken and verified during this launch.
    Created,
    /// Not taken. The upgrade must not proceed.
    Failed(String),
}

impl BackupOutcome {
    pub fn is_safe_to_migrate(&self) -> bool {
        !matches!(self, BackupOutcome::Failed(_))
    }
    pub fn reason(&self) -> Option<String> {
        match self {
            BackupOutcome::Failed(r) => Some(r.clone()),
            _ => None,
        }
    }
}

/// The gate the frontend checks before it opens the database.
#[derive(Default)]
pub struct MigrationGate(pub Mutex<Option<BackupOutcome>>);

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn backup_dir(root: &Path, version: u32) -> PathBuf {
    root.join(format!("backup-pre-v{version}"))
}
fn staging_dir(root: &Path, version: u32) -> PathBuf {
    root.join(format!(".backup-pre-v{version}.staging"))
}
fn manifest_path(dir: &Path) -> PathBuf {
    dir.join("MANIFEST.txt")
}

/// True when a COMPLETE backup exists — proven by the manifest, which is written
/// last. The presence of the database file alone proves only that a copy started.
pub fn backup_is_complete(root: &Path, version: u32) -> bool {
    let dir = backup_dir(root, version);
    if !manifest_path(&dir).exists() {
        return false;
    }
    // The manifest lists what must be present; a missing component invalidates it.
    let Ok(text) = fs::read_to_string(manifest_path(&dir)) else {
        return false;
    };
    for line in text.lines() {
        let Some((name, size)) = line.split_once('=') else { continue };
        let want: u64 = match size.trim().parse() {
            Ok(n) => n,
            Err(_) => return false,
        };
        match fs::metadata(dir.join(name.trim())) {
            Ok(m) if m.len() == want => {}
            _ => return false,
        }
    }
    true
}

/// Does this file look like a SQLite database?
pub fn looks_like_sqlite(path: &Path) -> bool {
    let Ok(mut f) = fs::File::open(path) else { return false };
    let mut head = [0u8; 16];
    match f.read_exact(&mut head) {
        Ok(()) => &head == SQLITE_MAGIC,
        Err(_) => false,
    }
}

/// Take the lock, or say who has it. Returns the lock path on success.
fn acquire_lock(root: &Path) -> Result<PathBuf, String> {
    let lock = root.join(".backup.lock");
    if let Ok(text) = fs::read_to_string(&lock) {
        let age = text
            .split_once('@')
            .and_then(|(_, t)| t.trim().parse::<u128>().ok())
            .map(|then| now_ms().saturating_sub(then))
            .unwrap_or(u128::MAX);
        if age < LOCK_STALE_MS {
            return Err(
                "Another copy of W.T.E is starting up or backing up. Close every W.T.E window and try again."
                    .to_string(),
            );
        }
        // Stale: the holder died. Take it over rather than wedging the app.
        let _ = fs::remove_file(&lock);
    }
    fs::write(&lock, format!("{}@{}", std::process::id(), now_ms()))
        .map_err(|e| format!("could not take the backup lock: {e}"))?;
    Ok(lock)
}

/// Copy the database aside before a migration that cannot be undone.
///
/// Pure enough to test: everything is expressed in terms of `root`.
pub fn run_backup(root: &Path, version: u32) -> BackupOutcome {
    let db = root.join("wte.db");
    if !db.exists() {
        return BackupOutcome::NothingToDo;
    }
    if backup_is_complete(root, version) {
        return BackupOutcome::AlreadyDone;
    }

    let lock = match acquire_lock(root) {
        Ok(l) => l,
        Err(e) => return BackupOutcome::Failed(e),
    };
    let result = backup_inner(root, version);
    let _ = fs::remove_file(&lock);
    result
}

fn backup_inner(root: &Path, version: u32) -> BackupOutcome {
    let staging = staging_dir(root, version);
    // A staging directory left by a previous failed attempt is rubbish, not a
    // backup. Clear it so a half-copy can never be promoted.
    let _ = fs::remove_dir_all(&staging);
    if let Err(e) = fs::create_dir_all(&staging) {
        return BackupOutcome::Failed(format!("could not create the backup folder: {e}"));
    }

    let mut manifest = String::new();
    for part in DB_PARTS {
        let from = root.join(part);
        if !from.exists() {
            continue; // -wal and -shm are absent after a clean shutdown
        }
        let to = staging.join(part);
        if let Err(e) = fs::copy(&from, &to) {
            let _ = fs::remove_dir_all(&staging);
            return BackupOutcome::Failed(format!("could not copy {part}: {e}"));
        }
        // Verify EVERY component, not just the database.
        let (a, b) = match (fs::metadata(&from), fs::metadata(&to)) {
            (Ok(a), Ok(b)) => (a.len(), b.len()),
            _ => {
                let _ = fs::remove_dir_all(&staging);
                return BackupOutcome::Failed(format!("could not check the copy of {part}"));
            }
        };
        if a != b {
            let _ = fs::remove_dir_all(&staging);
            return BackupOutcome::Failed(format!("the copy of {part} is {b} bytes but the original is {a}"));
        }
        manifest.push_str(&format!("{part}={b}\n"));
    }

    if !looks_like_sqlite(&staging.join("wte.db")) {
        let _ = fs::remove_dir_all(&staging);
        return BackupOutcome::Failed("the copied database does not look like a SQLite file".into());
    }

    // Publish atomically: the directory arrives whole under its final name, and
    // only then does the manifest declare it complete.
    let final_dir = backup_dir(root, version);
    let _ = fs::remove_dir_all(&final_dir);
    if let Err(e) = fs::rename(&staging, &final_dir) {
        let _ = fs::remove_dir_all(&staging);
        return BackupOutcome::Failed(format!("could not finalise the backup: {e}"));
    }
    if let Err(e) = fs::write(manifest_path(&final_dir), &manifest) {
        return BackupOutcome::Failed(format!("could not write the backup manifest: {e}"));
    }
    if !backup_is_complete(root, version) {
        return BackupOutcome::Failed("the finished backup did not verify".into());
    }
    BackupOutcome::Created
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("wte-backup-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    fn write_db(root: &Path, bytes: usize) {
        let mut f = fs::File::create(root.join("wte.db")).unwrap();
        f.write_all(SQLITE_MAGIC).unwrap();
        f.write_all(&vec![0u8; bytes]).unwrap();
    }

    #[test]
    fn does_nothing_when_there_is_no_database() {
        let root = temp_root("empty");
        assert_eq!(run_backup(&root, 5), BackupOutcome::NothingToDo);
    }

    #[test]
    fn creates_and_verifies_a_backup() {
        let root = temp_root("create");
        write_db(&root, 512);
        fs::write(root.join("wte.db-wal"), b"wal contents").unwrap();
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        assert!(backup_is_complete(&root, 5));
        // Both components came, not just the database.
        assert!(backup_dir(&root, 5).join("wte.db").exists());
        assert!(backup_dir(&root, 5).join("wte.db-wal").exists());
    }

    #[test]
    fn is_idempotent() {
        let root = temp_root("idem");
        write_db(&root, 64);
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        assert_eq!(run_backup(&root, 5), BackupOutcome::AlreadyDone);
    }

    #[test]
    fn a_missing_component_means_incomplete() {
        // The old routine treated the main file's existence as completion, so a
        // failed WAL copy was permanently skipped on every later launch.
        let root = temp_root("partial");
        write_db(&root, 64);
        fs::write(root.join("wte.db-wal"), b"wal").unwrap();
        run_backup(&root, 5);
        fs::remove_file(backup_dir(&root, 5).join("wte.db-wal")).unwrap();
        assert!(!backup_is_complete(&root, 5), "a missing component must invalidate the backup");
    }

    #[test]
    fn a_truncated_copy_means_incomplete() {
        let root = temp_root("truncated");
        write_db(&root, 4096);
        run_backup(&root, 5);
        fs::write(backup_dir(&root, 5).join("wte.db"), b"short").unwrap();
        assert!(!backup_is_complete(&root, 5));
    }

    #[test]
    fn a_backup_without_a_manifest_is_not_complete() {
        // The manifest is written LAST, so its absence means the copy did not finish.
        let root = temp_root("nomanifest");
        write_db(&root, 64);
        run_backup(&root, 5);
        fs::remove_file(manifest_path(&backup_dir(&root, 5))).unwrap();
        assert!(!backup_is_complete(&root, 5));
    }

    #[test]
    fn refuses_while_another_instance_holds_the_lock() {
        let root = temp_root("locked");
        write_db(&root, 64);
        fs::write(root.join(".backup.lock"), format!("99999@{}", now_ms())).unwrap();
        match run_backup(&root, 5) {
            BackupOutcome::Failed(r) => assert!(r.contains("Another copy"), "got: {r}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn takes_over_a_stale_lock_instead_of_wedging() {
        let root = temp_root("stale");
        write_db(&root, 64);
        let ancient = now_ms().saturating_sub(LOCK_STALE_MS + 1000);
        fs::write(root.join(".backup.lock"), format!("99999@{ancient}")).unwrap();
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
    }

    #[test]
    fn rejects_a_file_that_is_not_a_database() {
        let root = temp_root("notdb");
        fs::write(root.join("wte.db"), b"this is not a sqlite file at all").unwrap();
        match run_backup(&root, 5) {
            BackupOutcome::Failed(r) => assert!(r.contains("SQLite"), "got: {r}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn a_failed_backup_is_not_safe_to_migrate() {
        assert!(!BackupOutcome::Failed("x".into()).is_safe_to_migrate());
        assert!(BackupOutcome::Created.is_safe_to_migrate());
        assert!(BackupOutcome::AlreadyDone.is_safe_to_migrate());
        assert!(BackupOutcome::NothingToDo.is_safe_to_migrate());
    }

    #[test]
    fn leftover_staging_is_cleared_rather_than_promoted() {
        let root = temp_root("staging");
        write_db(&root, 64);
        let staging = staging_dir(&root, 5);
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join("wte.db"), b"junk from a crashed attempt").unwrap();
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        assert!(looks_like_sqlite(&backup_dir(&root, 5).join("wte.db")));
    }
}
