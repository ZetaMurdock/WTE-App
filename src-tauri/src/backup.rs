// Pre-migration database backup.
//
// A schema migration this app cannot undo is only acceptable if going back is a
// matter of restoring files. Two earlier versions of this routine did not clear
// that bar.
//
// The first copied db/wal/shm separately, treated the existence of the main file
// as proof of completion, printed failures to a console nobody reads, and let the
// migration proceed anyway.
//
// The second staged, verified sizes, and gated the migration on the result — but
// still copied three live files independently, which cannot produce a consistent
// database if anything writes during the copy, and its "verification" was a size
// comparison and a sixteen-byte header check. It also defended itself with a text
// lock file that an older W.T.E has never heard of.
//
// What it does now:
//   - reads the source's schema version FIRST, and refuses to write a
//     "pre-v5" backup from a database that is already v5 — the failure mode where
//     an incomplete backup gets replaced by the migrated database wearing its name;
//   - takes the snapshot with VACUUM INTO, so SQLite itself guarantees a single
//     consistent moment. This is also what makes it safe against an older W.T.E
//     writing concurrently: the snapshot is a read transaction, not a file copy,
//     so it does not matter that the other process never saw our lock;
//   - verifies the snapshot by opening it, running integrity_check, and comparing
//     every table's row count against the source;
//   - records the source schema version, byte length and SHA-256 of every file,
//     and re-checks all of it before ever calling a backup complete;
//   - publishes atomically — the manifest is written INSIDE the staging directory,
//     so the rename that puts it in place is the moment it becomes complete;
//   - reports failure through a gate the app checks BEFORE opening the database,
//     which fails closed.
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The one file a snapshot consists of. VACUUM INTO produces a complete, compacted
/// database with no WAL of its own, so restoring is putting this back and deleting
/// any stale -wal/-shm — rather than getting three separate files to agree.
pub const SNAPSHOT: &str = "wte.db";

/// Manifest format. Bumped if the fields below ever change meaning, so an old
/// manifest is never read as if it were a new one.
const MANIFEST_FORMAT: u32 = 2;
const MANIFEST_NAME: &str = "MANIFEST.json";

/// A lock older than this belonged to a process that died holding it. The backup
/// itself takes seconds; minutes of staleness is unambiguous.
const LOCK_STALE_MS: u128 = 5 * 60 * 1000;

#[derive(Debug, Clone, PartialEq)]
pub enum BackupOutcome {
    /// A fresh install with no database yet.
    NothingToDo,
    /// A verified backup for this version already exists.
    AlreadyDone,
    /// The database has already been migrated to this version or past it. No
    /// pre-upgrade copy can be taken now, and any existing one must be left
    /// exactly as it is rather than overwritten with a migrated database.
    AlreadyMigrated { restore_point: bool },
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
    /// Is there a copy to go back to? False is not an error — a fresh install has
    /// nothing to preserve — but it is never guessed at.
    pub fn has_restore_point(&self) -> bool {
        match self {
            BackupOutcome::AlreadyDone | BackupOutcome::Created => true,
            BackupOutcome::AlreadyMigrated { restore_point } => *restore_point,
            _ => false,
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            BackupOutcome::NothingToDo => "nothing-to-do",
            BackupOutcome::AlreadyDone => "already-done",
            BackupOutcome::AlreadyMigrated { .. } => "already-migrated",
            BackupOutcome::Created => "created",
            BackupOutcome::Failed(_) => "failed",
        }
    }
}

/// The gate the frontend checks before it opens the database.
#[derive(Default)]
pub struct MigrationGate(pub Mutex<Option<BackupOutcome>>);

#[derive(Serialize, Deserialize, Debug)]
struct FileRecord {
    name: String,
    bytes: u64,
    sha256: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct Manifest {
    format: u32,
    /// The schema the source was on when this was taken. The whole point: a
    /// manifest saying 5 is not a pre-v5 backup, whatever the folder is called.
    source_schema_version: u32,
    target_schema_version: u32,
    integrity: String,
    files: Vec<FileRecord>,
    row_counts: BTreeMap<String, i64>,
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

pub fn backup_dir(root: &Path, version: u32) -> PathBuf {
    root.join(format!("backup-pre-v{version}"))
}
fn staging_dir(root: &Path, version: u32) -> PathBuf {
    root.join(format!(".backup-pre-v{version}.staging"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(|e| format!("{e}"))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| format!("{e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Every table's row count. Comparing these between source and snapshot is what
/// proves the copy holds the same data, which no amount of size checking can.
fn row_counts(conn: &Connection) -> Result<BTreeMap<String, i64>, String> {
    let mut names: Vec<String> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .map_err(|e| format!("{e}"))?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| format!("{e}"))?;
        for r in rows {
            names.push(r.map_err(|e| format!("{e}"))?);
        }
    }
    let mut out = BTreeMap::new();
    for name in names {
        // Table names come from sqlite_master, not from user input, but quote them
        // anyway so an odd one cannot change the statement's shape.
        let sql = format!("SELECT COUNT(*) FROM \"{}\"", name.replace('"', "\"\""));
        let n: i64 = conn.query_row(&sql, [], |r| r.get(0)).map_err(|e| format!("{e}"))?;
        out.insert(name, n);
    }
    Ok(out)
}

/// The highest migration this database has applied. 0 when it has none, which is a
/// fresh or never-migrated database rather than an error.
fn schema_version(conn: &Connection) -> Result<u32, String> {
    let has: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_sqlx_migrations'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("could not read the migration table: {e}"))?;
    if has == 0 {
        return Ok(0);
    }
    let v: Option<i64> = conn
        .query_row("SELECT MAX(version) FROM _sqlx_migrations", [], |r| r.get(0))
        .map_err(|e| format!("could not read the migration table: {e}"))?;
    Ok(v.unwrap_or(0).max(0) as u32)
}

fn integrity_of(conn: &Connection, pragma: &str) -> Result<String, String> {
    conn.query_row(&format!("PRAGMA {pragma}"), [], |r| r.get::<_, String>(0))
        .map_err(|e| format!("{e}"))
}

/// Read the manifest a backup directory carries, if it has a usable one.
fn read_manifest(dir: &Path) -> Option<Manifest> {
    let text = fs::read_to_string(dir.join(MANIFEST_NAME)).ok()?;
    let m: Manifest = serde_json::from_str(&text).ok()?;
    if m.format != MANIFEST_FORMAT {
        return None;
    }
    // An empty file list is not a description of a backup. The previous version
    // accepted one and called it complete.
    if m.files.is_empty() || !m.files.iter().any(|f| f.name == SNAPSHOT) {
        return None;
    }
    Some(m)
}

/// Is the backup in this directory complete AND still intact?
///
/// Every recorded file must be present at its recorded length with its recorded
/// hash. Hashing costs a second on a large database, which is why the caller only
/// reaches here when it genuinely matters.
pub fn backup_is_complete_at(dir: &Path, target: u32) -> bool {
    let Some(m) = read_manifest(dir) else { return false };
    if m.target_schema_version != target {
        return false;
    }
    // A backup taken from a database that was ALREADY at the target is not a
    // pre-upgrade backup, whatever the folder is named.
    if m.source_schema_version >= target {
        return false;
    }
    if m.integrity != "ok" {
        return false;
    }
    for f in &m.files {
        let p = dir.join(&f.name);
        match fs::metadata(&p) {
            Ok(meta) if meta.len() == f.bytes => {}
            _ => return false,
        }
        match sha256_file(&p) {
            Ok(h) if h == f.sha256 => {}
            _ => return false,
        }
    }
    true
}

pub fn backup_is_complete(root: &Path, target: u32) -> bool {
    backup_is_complete_at(&backup_dir(root, target), target)
}

/// A cheap "is something there?" for reporting, without re-hashing a large file.
/// Never used to decide whether it is safe to migrate.
fn restore_point_present(root: &Path, target: u32) -> bool {
    let dir = backup_dir(root, target);
    let Some(m) = read_manifest(&dir) else { return false };
    if m.source_schema_version >= target {
        return false;
    }
    m.files
        .iter()
        .all(|f| fs::metadata(dir.join(&f.name)).map(|x| x.len() == f.bytes).unwrap_or(false))
}

/// Take the lock, or say who has it.
///
/// `create_new` is a single atomic filesystem operation, so two processes racing
/// here cannot both succeed. The previous version read the file and then wrote it,
/// which is two operations with a gap in the middle.
fn acquire_lock(root: &Path) -> Result<PathBuf, String> {
    use std::io::Write;
    let lock = root.join(".backup.lock");
    let mut attempts = 0;
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(mut f) => {
                let _ = write!(f, "{}@{}", std::process::id(), now_ms());
                return Ok(lock);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if attempts > 0 {
                    // We already cleared one stale lock and someone took it first.
                    // That someone is alive; do not fight them for it.
                    return Err(BUSY.to_string());
                }
                attempts += 1;
                let age = fs::read_to_string(&lock)
                    .ok()
                    .and_then(|t| t.split_once('@').and_then(|(_, ts)| ts.trim().parse::<u128>().ok()))
                    .map(|then| now_ms().saturating_sub(then))
                    .unwrap_or(u128::MAX);
                if age < LOCK_STALE_MS {
                    return Err(BUSY.to_string());
                }
                // Stale: the holder died. Take it over rather than wedging the app.
                let _ = fs::remove_file(&lock);
            }
            Err(e) => return Err(format!("could not take the backup lock: {e}")),
        }
    }
}

const BUSY: &str =
    "Another copy of W.T.E is starting up or backing up. Close every W.T.E window and try again.";

/// Copy the database aside before a migration that cannot be undone.
///
/// Expressed entirely in terms of `root`, so the whole thing is testable against a
/// real database in a temporary directory.
pub fn run_backup(root: &Path, target: u32) -> BackupOutcome {
    let db = root.join("wte.db");
    if !db.exists() {
        return BackupOutcome::NothingToDo;
    }

    // BEFORE anything else. A database already at or past the target cannot yield
    // a pre-upgrade copy, and must never be written over one.
    let source_version = match Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| format!("{e}"))
        .and_then(|c| schema_version(&c))
    {
        Ok(v) => v,
        Err(e) => return BackupOutcome::Failed(format!("the database could not be read: {e}")),
    };
    if source_version >= target {
        return BackupOutcome::AlreadyMigrated {
            restore_point: restore_point_present(root, target),
        };
    }

    if backup_is_complete(root, target) {
        return BackupOutcome::AlreadyDone;
    }

    let lock = match acquire_lock(root) {
        Ok(l) => l,
        Err(e) => return BackupOutcome::Failed(e),
    };
    let result = backup_inner(root, target, &db, source_version);
    let _ = fs::remove_file(&lock);
    result
}

fn backup_inner(root: &Path, target: u32, db: &Path, source_version: u32) -> BackupOutcome {
    let staging = staging_dir(root, target);
    // A staging directory left by a failed attempt is rubbish, not a backup.
    let _ = fs::remove_dir_all(&staging);
    if let Err(e) = fs::create_dir_all(&staging) {
        return BackupOutcome::Failed(format!("could not create the backup folder: {e}"));
    }

    let outcome = (|| -> Result<Manifest, String> {
        let source = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|e| format!("the database could not be opened: {e}"))?;

        // Pre-flight. Snapshotting a database that is already damaged would
        // faithfully preserve the damage and call it a restore point.
        let pre = integrity_of(&source, "quick_check")
            .map_err(|e| format!("the database could not be checked: {e}"))?;
        if pre != "ok" {
            return Err(format!("the database did not pass its own integrity check ({pre})"));
        }
        let source_counts = row_counts(&source).map_err(|e| format!("the database could not be read: {e}"))?;

        // The snapshot. SQLite holds a read transaction for the duration, so the
        // result is one consistent moment even if something else is writing —
        // including an older W.T.E that never heard of our lock file.
        let dest = staging.join(SNAPSHOT);
        let dest_sql = dest.to_string_lossy().replace('\'', "''");
        source
            .execute_batch(&format!("VACUUM INTO '{dest_sql}'"))
            .map_err(|e| format!("the snapshot could not be written: {e}"))?;
        drop(source);

        // Verify the artefact itself, not the operation that produced it.
        let copy = Connection::open_with_flags(&dest, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("the snapshot could not be reopened: {e}"))?;
        let integrity = integrity_of(&copy, "integrity_check")
            .map_err(|e| format!("the snapshot could not be checked: {e}"))?;
        if integrity != "ok" {
            return Err(format!("the snapshot failed its integrity check ({integrity})"));
        }
        let copy_counts = row_counts(&copy).map_err(|e| format!("the snapshot could not be read: {e}"))?;
        if copy_counts != source_counts {
            let diff: Vec<String> = source_counts
                .iter()
                .filter(|(k, v)| copy_counts.get(*k) != Some(v))
                .map(|(k, v)| format!("{k}: {v} became {}", copy_counts.get(k).copied().unwrap_or(-1)))
                .collect();
            return Err(format!("the snapshot does not hold the same data ({})", diff.join("; ")));
        }
        let copy_version = schema_version(&copy)?;
        if copy_version != source_version {
            return Err(format!(
                "the snapshot is on schema {copy_version} but the database was on {source_version}"
            ));
        }
        drop(copy);

        let bytes = fs::metadata(&dest).map_err(|e| format!("{e}"))?.len();
        let sha256 = sha256_file(&dest)?;

        Ok(Manifest {
            format: MANIFEST_FORMAT,
            source_schema_version: source_version,
            target_schema_version: target,
            integrity,
            files: vec![FileRecord { name: SNAPSHOT.into(), bytes, sha256 }],
            row_counts: source_counts,
        })
    })();

    let manifest = match outcome {
        Ok(m) => m,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return BackupOutcome::Failed(e);
        }
    };

    // The manifest goes INSIDE staging, so the rename below is the single moment
    // the backup becomes complete. Nothing can observe a described-but-absent file.
    let json = match serde_json::to_string_pretty(&manifest) {
        Ok(j) => j,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return BackupOutcome::Failed(format!("could not write the backup manifest: {e}"));
        }
    };
    if let Err(e) = fs::write(staging.join(MANIFEST_NAME), json) {
        let _ = fs::remove_dir_all(&staging);
        return BackupOutcome::Failed(format!("could not write the backup manifest: {e}"));
    }
    // Check the staged copy the same way every later launch will.
    if !backup_is_complete_at(&staging, target) {
        let _ = fs::remove_dir_all(&staging);
        return BackupOutcome::Failed("the finished backup did not verify".into());
    }

    let final_dir = backup_dir(root, target);
    // Only ever removes a directory that is NOT a valid restore point — a complete
    // one returned AlreadyDone long before this, and a pre-migration source is a
    // precondition of getting here at all.
    if final_dir.exists() {
        if let Err(e) = fs::remove_dir_all(&final_dir) {
            let _ = fs::remove_dir_all(&staging);
            return BackupOutcome::Failed(format!("could not clear the previous incomplete backup: {e}"));
        }
    }
    if let Err(e) = fs::rename(&staging, &final_dir) {
        let _ = fs::remove_dir_all(&staging);
        return BackupOutcome::Failed(format!("could not finalise the backup: {e}"));
    }
    BackupOutcome::Created
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("wte-backup-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Record a migration as applied, whatever shape the table happens to have.
    ///
    /// The real _sqlx_migrations carries success, checksum and execution_time as
    /// NOT NULL; the one the other tests build has two columns. Reading the columns
    /// rather than assuming them is what lets the same helper drive both.
    fn mark_migrated(conn: &Connection, version: u32) {
        let mut cols: Vec<(String, String)> = Vec::new();
        {
            let mut stmt = conn.prepare("PRAGMA table_info(_sqlx_migrations)").unwrap();
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
                .unwrap();
            for r in rows {
                cols.push(r.unwrap());
            }
        }
        let mut names = Vec::new();
        let mut values = Vec::new();
        for (name, ty) in &cols {
            names.push(format!("\"{name}\""));
            values.push(match name.as_str() {
                "version" => version.to_string(),
                "description" => "'test'".into(),
                "success" => "1".into(),
                "checksum" => "X'00'".into(),
                "installed_on" => "CURRENT_TIMESTAMP".into(),
                _ if ty.to_uppercase().contains("BLOB") => "X'00'".into(),
                _ if ty.to_uppercase().contains("TEXT") => "''".into(),
                _ => "0".into(),
            });
        }
        conn.execute(
            &format!("INSERT INTO _sqlx_migrations ({}) VALUES ({})", names.join(","), values.join(",")),
            [],
        )
        .unwrap();
    }

    /// A database shaped like the real one: WAL mode, a migration table, real rows.
    fn make_db(root: &Path, version: u32, rows: i64) -> PathBuf {
        let path = root.join("wte.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, name TEXT);
             CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, data TEXT);",
        )
        .unwrap();
        for i in 0..rows {
            conn.execute("INSERT INTO campaigns (id, name) VALUES (?1, ?2)", (i.to_string(), format!("c{i}")))
                .unwrap();
        }
        if version > 0 {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT);",
            )
            .unwrap();
            for v in 1..=version {
                conn.execute("INSERT OR IGNORE INTO _sqlx_migrations (version, description) VALUES (?1, 'x')", [v])
                    .unwrap();
            }
        }
        drop(conn);
        path
    }

    #[test]
    fn does_nothing_when_there_is_no_database() {
        let root = temp_root("empty");
        assert_eq!(run_backup(&root, 5), BackupOutcome::NothingToDo);
    }

    #[test]
    fn creates_and_verifies_a_snapshot() {
        let root = temp_root("create");
        make_db(&root, 4, 25);
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        assert!(backup_is_complete(&root, 5));
        // The snapshot is a real database holding the same rows.
        let copy = Connection::open(backup_dir(&root, 5).join(SNAPSHOT)).unwrap();
        let n: i64 = copy.query_row("SELECT COUNT(*) FROM campaigns", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 25);
    }

    #[test]
    fn records_the_schema_it_was_taken_from() {
        let root = temp_root("version");
        make_db(&root, 4, 3);
        run_backup(&root, 5);
        let m = read_manifest(&backup_dir(&root, 5)).unwrap();
        assert_eq!(m.source_schema_version, 4);
        assert_eq!(m.target_schema_version, 5);
    }

    #[test]
    fn is_idempotent() {
        let root = temp_root("idem");
        make_db(&root, 4, 3);
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        assert_eq!(run_backup(&root, 5), BackupOutcome::AlreadyDone);
    }

    #[test]
    fn never_overwrites_a_backup_once_the_database_has_migrated() {
        // THE failure this version exists to remove: the pre-v5 copy is replaced by
        // the now-v5 database, still wearing the name "backup-pre-v5".
        let root = temp_root("noclobber");
        make_db(&root, 4, 7);
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        let before = fs::read(backup_dir(&root, 5).join(SNAPSHOT)).unwrap();

        // The migration happens, and rows change.
        let conn = Connection::open(root.join("wte.db")).unwrap();
        mark_migrated(&conn, 5);
        conn.execute("INSERT INTO campaigns (id, name) VALUES ('new', 'after')", []).unwrap();
        drop(conn);

        assert_eq!(run_backup(&root, 5), BackupOutcome::AlreadyMigrated { restore_point: true });
        assert_eq!(fs::read(backup_dir(&root, 5).join(SNAPSHOT)).unwrap(), before, "the backup was replaced");
    }

    #[test]
    fn refuses_to_manufacture_a_restore_point_after_the_fact() {
        // Migrated, and no backup was ever taken. Saying so is the only honest
        // answer; copying the migrated database would be a lie with a filename.
        let root = temp_root("late");
        make_db(&root, 5, 3);
        assert_eq!(run_backup(&root, 5), BackupOutcome::AlreadyMigrated { restore_point: false });
        assert!(!backup_dir(&root, 5).exists());
    }

    #[test]
    fn an_empty_manifest_is_not_a_backup() {
        let root = temp_root("emptymanifest");
        make_db(&root, 4, 3);
        run_backup(&root, 5);
        let dir = backup_dir(&root, 5);
        fs::write(
            dir.join(MANIFEST_NAME),
            serde_json::json!({
                "format": MANIFEST_FORMAT, "source_schema_version": 4, "target_schema_version": 5,
                "integrity": "ok", "files": [], "row_counts": {}
            })
            .to_string(),
        )
        .unwrap();
        assert!(!backup_is_complete(&root, 5));
    }

    #[test]
    fn a_manifest_claiming_a_migrated_source_is_not_a_pre_upgrade_backup() {
        let root = temp_root("wrongversion");
        make_db(&root, 4, 3);
        run_backup(&root, 5);
        let dir = backup_dir(&root, 5);
        let mut m = read_manifest(&dir).unwrap();
        m.source_schema_version = 5;
        fs::write(dir.join(MANIFEST_NAME), serde_json::to_string(&m).unwrap()).unwrap();
        assert!(!backup_is_complete(&root, 5));
    }

    #[test]
    fn a_tampered_snapshot_fails_its_hash() {
        // Size-and-header checking passed this. A hash does not.
        let root = temp_root("tampered");
        make_db(&root, 4, 3);
        run_backup(&root, 5);
        let snap = backup_dir(&root, 5).join(SNAPSHOT);
        let mut bytes = fs::read(&snap).unwrap();
        let n = bytes.len();
        bytes[n - 1] ^= 0xff; // same length, still starts with the SQLite header
        fs::write(&snap, &bytes).unwrap();
        assert!(!backup_is_complete(&root, 5));
    }

    #[test]
    fn a_missing_snapshot_means_incomplete() {
        let root = temp_root("missing");
        make_db(&root, 4, 3);
        run_backup(&root, 5);
        fs::remove_file(backup_dir(&root, 5).join(SNAPSHOT)).unwrap();
        assert!(!backup_is_complete(&root, 5));
    }

    #[test]
    fn a_backup_without_a_manifest_is_not_complete() {
        let root = temp_root("nomanifest");
        make_db(&root, 4, 3);
        run_backup(&root, 5);
        fs::remove_file(backup_dir(&root, 5).join(MANIFEST_NAME)).unwrap();
        assert!(!backup_is_complete(&root, 5));
    }

    #[test]
    fn refuses_while_another_instance_holds_the_lock() {
        let root = temp_root("locked");
        make_db(&root, 4, 3);
        fs::write(root.join(".backup.lock"), format!("99999@{}", now_ms())).unwrap();
        match run_backup(&root, 5) {
            BackupOutcome::Failed(r) => assert!(r.contains("Another copy"), "got: {r}"),
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn lock_acquisition_is_exclusive() {
        // Two acquisitions in a row: the second must fail, not overwrite the first.
        let root = temp_root("exclusive");
        let first = acquire_lock(&root).unwrap();
        assert!(acquire_lock(&root).is_err());
        fs::remove_file(&first).unwrap();
        assert!(acquire_lock(&root).is_ok());
    }

    #[test]
    fn takes_over_a_stale_lock_instead_of_wedging() {
        let root = temp_root("stale");
        make_db(&root, 4, 3);
        let ancient = now_ms().saturating_sub(LOCK_STALE_MS + 1000);
        fs::write(root.join(".backup.lock"), format!("99999@{ancient}")).unwrap();
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
    }

    #[test]
    fn releases_the_lock_when_the_backup_fails() {
        let root = temp_root("release");
        fs::write(root.join("wte.db"), b"this is not a database").unwrap();
        assert!(matches!(run_backup(&root, 5), BackupOutcome::Failed(_)));
        assert!(!root.join(".backup.lock").exists(), "a failed run must not leave the lock behind");
    }

    #[test]
    fn rejects_a_file_that_is_not_a_database() {
        let root = temp_root("notdb");
        fs::write(root.join("wte.db"), b"this is not a sqlite file at all").unwrap();
        assert!(matches!(run_backup(&root, 5), BackupOutcome::Failed(_)));
        assert!(!backup_dir(&root, 5).exists());
    }

    #[test]
    fn snapshots_data_still_sitting_in_the_write_ahead_log() {
        // The case three independent file copies get wrong. Rows committed but not
        // yet checkpointed live in the -wal; a snapshot must contain them.
        let root = temp_root("wal");
        make_db(&root, 4, 5);
        let conn = Connection::open(root.join("wte.db")).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
        for i in 100..150 {
            conn.execute("INSERT INTO campaigns (id, name) VALUES (?1, 'wal')", [i.to_string()]).unwrap();
        }
        // Deliberately do NOT checkpoint, and keep the connection open.
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        let copy = Connection::open(backup_dir(&root, 5).join(SNAPSHOT)).unwrap();
        let n: i64 = copy.query_row("SELECT COUNT(*) FROM campaigns", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 55, "the snapshot lost rows that were still in the WAL");
        drop(conn);
    }

    #[test]
    fn a_failed_backup_is_not_safe_to_migrate() {
        assert!(!BackupOutcome::Failed("x".into()).is_safe_to_migrate());
        assert!(BackupOutcome::Created.is_safe_to_migrate());
        assert!(BackupOutcome::AlreadyDone.is_safe_to_migrate());
        assert!(BackupOutcome::NothingToDo.is_safe_to_migrate());
        assert!(BackupOutcome::AlreadyMigrated { restore_point: false }.is_safe_to_migrate());
    }

    #[test]
    fn only_a_real_copy_counts_as_a_restore_point() {
        assert!(BackupOutcome::Created.has_restore_point());
        assert!(BackupOutcome::AlreadyDone.has_restore_point());
        assert!(!BackupOutcome::AlreadyMigrated { restore_point: false }.has_restore_point());
        assert!(!BackupOutcome::NothingToDo.has_restore_point());
        assert!(!BackupOutcome::Failed("x".into()).has_restore_point());
    }

    #[test]
    fn leftover_staging_is_cleared_rather_than_promoted() {
        let root = temp_root("staging");
        make_db(&root, 4, 3);
        let staging = staging_dir(&root, 5);
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join(SNAPSHOT), b"junk from a crashed attempt").unwrap();
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);
        assert!(backup_is_complete(&root, 5));
    }

    #[test]
    fn a_restore_actually_restores() {
        // The whole promise, end to end: snapshot, migrate, put it back, read the
        // pre-migration state.
        let root = temp_root("restore");
        let db = make_db(&root, 4, 10);
        assert_eq!(run_backup(&root, 5), BackupOutcome::Created);

        let conn = Connection::open(&db).unwrap();
        mark_migrated(&conn, 5);
        conn.execute("DELETE FROM campaigns", []).unwrap();
        drop(conn);

        // Restore is: put the snapshot back, drop any stale sidecars.
        fs::copy(backup_dir(&root, 5).join(SNAPSHOT), &db).unwrap();
        let _ = fs::remove_file(root.join("wte.db-wal"));
        let _ = fs::remove_file(root.join("wte.db-shm"));

        let back = Connection::open(&db).unwrap();
        assert_eq!(schema_version(&back).unwrap(), 4, "restored database is still migrated");
        let n: i64 = back.query_row("SELECT COUNT(*) FROM campaigns", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 10, "restored database lost its rows");
    }

    /// Run the real thing against a copy of a real database.
    ///
    /// Skipped unless WTE_BACKUP_TEST_DB names one, because CI has no such file —
    /// but it is the only test that proves this works at 188 MB with the actual
    /// table set rather than the two tables the other tests invent.
    #[test]
    fn against_a_real_database_clone() {
        let Ok(src) = std::env::var("WTE_BACKUP_TEST_DB") else {
            eprintln!("skipped: set WTE_BACKUP_TEST_DB to a CLONE of a real wte.db");
            return;
        };
        let root = temp_root("realclone");
        fs::copy(&src, root.join("wte.db")).expect("could not copy the test database");

        let before = Connection::open(root.join("wte.db")).unwrap();
        let before_counts = row_counts(&before).unwrap();
        let before_version = schema_version(&before).unwrap();
        drop(before);
        eprintln!("source: schema v{before_version}, {} tables", before_counts.len());

        let target = before_version + 1;
        assert_eq!(run_backup(&root, target), BackupOutcome::Created);
        assert!(backup_is_complete(&root, target));

        let copy = Connection::open(backup_dir(&root, target).join(SNAPSHOT)).unwrap();
        assert_eq!(row_counts(&copy).unwrap(), before_counts);
        assert_eq!(schema_version(&copy).unwrap(), before_version);
        assert_eq!(integrity_of(&copy, "integrity_check").unwrap(), "ok");

        // And it will not clobber itself once that migration has been applied.
        drop(copy);
        let c = Connection::open(root.join("wte.db")).unwrap();
        mark_migrated(&c, target);
        drop(c);
        assert_eq!(run_backup(&root, target), BackupOutcome::AlreadyMigrated { restore_point: true });
    }
}
