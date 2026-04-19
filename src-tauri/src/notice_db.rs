//! Notice System SQLite storage — audit log + inbox queue.
//!
//! Tables:
//!   notice_audit  — every Gate decision for analytics + feedback learning
//!   notice_inbox  — L2 notices queued when Gate returns queue_inbox
//!
//! The DB file lives at `{app_data_dir}/notice.sqlite`. Created lazily
//! on first write. All commands are sync (rusqlite) wrapped in Tauri's
//! async command layer — acceptable because writes are small and
//! infrequent (< 100/hour at peak).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub struct NoticeDb {
    conn: Mutex<Connection>,
}

impl NoticeDb {
    pub fn open(path: &PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create notice DB dir: {}", e))?;
        }
        let conn = Connection::open(path)
            .map_err(|e| format!("Failed to open notice DB: {}", e))?;

        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;

            CREATE TABLE IF NOT EXISTS notice_audit (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                notice_id   TEXT NOT NULL,
                type        TEXT NOT NULL,
                tier        TEXT NOT NULL,
                source      TEXT NOT NULL,
                decision    TEXT NOT NULL,
                reason      TEXT,
                delivered_to TEXT NOT NULL DEFAULT '[]',
                timestamp   INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON notice_audit(timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_type      ON notice_audit(type, timestamp);

            CREATE TABLE IF NOT EXISTS notice_inbox (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                notice_id       TEXT UNIQUE NOT NULL,
                notice_json     TEXT NOT NULL,
                tier            TEXT NOT NULL,
                queued_at       INTEGER NOT NULL,
                expires_at      INTEGER NOT NULL,
                delivered       INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_inbox_expires ON notice_inbox(expires_at);
            ",
        )
        .map_err(|e| format!("Failed to init notice DB schema: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

// ── Audit types ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AuditInsert {
    pub notice_id: String,
    #[serde(rename = "type")]
    pub notice_type: String,
    pub tier: String,
    pub source: String,
    pub decision: String,
    pub reason: Option<String>,
    pub delivered_to: Vec<String>,
    pub timestamp: i64,
}

#[derive(Serialize, Clone)]
pub struct AuditEntry {
    pub id: i64,
    pub notice_id: String,
    #[serde(rename = "type")]
    pub notice_type: String,
    pub tier: String,
    pub source: String,
    pub decision: String,
    pub reason: Option<String>,
    pub delivered_to: Vec<String>,
    pub timestamp: i64,
}

// ── Inbox types ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InboxInsert {
    pub notice_id: String,
    pub notice_json: String,
    pub tier: String,
    pub queued_at: i64,
    pub expires_at: i64,
}

#[derive(Serialize, Clone)]
pub struct InboxEntry {
    pub id: i64,
    pub notice_id: String,
    pub notice_json: String,
    pub tier: String,
    pub queued_at: i64,
    pub expires_at: i64,
    pub delivered: bool,
}

// ── Tauri commands ─────────────────────────────────────────────────────

fn get_db(app: &AppHandle) -> Result<&NoticeDb, String> {
    app.try_state::<NoticeDb>()
        .ok_or_else(|| "Notice DB not initialized".to_string())
        .map(|s| s.inner())
}

#[tauri::command]
pub fn notice_audit_insert(app: AppHandle, entry: AuditInsert) -> Result<(), String> {
    let db = get_db(&app)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let delivered_json = serde_json::to_string(&entry.delivered_to)
        .unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT INTO notice_audit (notice_id, type, tier, source, decision, reason, delivered_to, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.notice_id,
            entry.notice_type,
            entry.tier,
            entry.source,
            entry.decision,
            entry.reason,
            delivered_json,
            entry.timestamp,
        ],
    )
    .map_err(|e| format!("audit insert failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn notice_audit_query(
    app: AppHandle,
    since: i64,
    until: i64,
    notice_type: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<AuditEntry>, String> {
    let db = get_db(&app)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let lim = limit.unwrap_or(100);

    let mut entries = Vec::new();
    if let Some(ref t) = notice_type {
        let mut stmt = conn
            .prepare(
                "SELECT id, notice_id, type, tier, source, decision, reason, delivered_to, timestamp
                 FROM notice_audit
                 WHERE timestamp >= ?1 AND timestamp <= ?2 AND type = ?3
                 ORDER BY timestamp DESC
                 LIMIT ?4",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since, until, t, lim], map_audit_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            entries.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, notice_id, type, tier, source, decision, reason, delivered_to, timestamp
                 FROM notice_audit
                 WHERE timestamp >= ?1 AND timestamp <= ?2
                 ORDER BY timestamp DESC
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since, until, lim], map_audit_row)
            .map_err(|e| e.to_string())?;
        for row in rows {
            entries.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(entries)
}

#[tauri::command]
pub fn notice_audit_aggregate(
    app: AppHandle,
    since: i64,
    until: i64,
) -> Result<Vec<(String, i64)>, String> {
    let db = get_db(&app)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT decision, COUNT(*) FROM notice_audit
             WHERE timestamp >= ?1 AND timestamp <= ?2
             GROUP BY decision",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![since, until], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

fn map_audit_row(row: &rusqlite::Row) -> rusqlite::Result<AuditEntry> {
    let delivered_str: String = row.get(7)?;
    let delivered_to: Vec<String> =
        serde_json::from_str(&delivered_str).unwrap_or_default();
    Ok(AuditEntry {
        id: row.get(0)?,
        notice_id: row.get(1)?,
        notice_type: row.get(2)?,
        tier: row.get(3)?,
        source: row.get(4)?,
        decision: row.get(5)?,
        reason: row.get(6)?,
        delivered_to,
        timestamp: row.get(8)?,
    })
}

// ── Inbox commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn notice_inbox_insert(app: AppHandle, entry: InboxInsert) -> Result<(), String> {
    let db = get_db(&app)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO notice_inbox (notice_id, notice_json, tier, queued_at, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            entry.notice_id,
            entry.notice_json,
            entry.tier,
            entry.queued_at,
            entry.expires_at,
        ],
    )
    .map_err(|e| format!("inbox insert failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn notice_inbox_pending(app: AppHandle, now: i64) -> Result<Vec<InboxEntry>, String> {
    let db = get_db(&app)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, notice_id, notice_json, tier, queued_at, expires_at, delivered
             FROM notice_inbox
             WHERE delivered = 0 AND expires_at > ?1
             ORDER BY queued_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![now], |row| {
            Ok(InboxEntry {
                id: row.get(0)?,
                notice_id: row.get(1)?,
                notice_json: row.get(2)?,
                tier: row.get(3)?,
                queued_at: row.get(4)?,
                expires_at: row.get(5)?,
                delivered: row.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub fn notice_inbox_mark_delivered(app: AppHandle, notice_id: String) -> Result<(), String> {
    let db = get_db(&app)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE notice_inbox SET delivered = 1 WHERE notice_id = ?1",
        params![notice_id],
    )
    .map_err(|e| format!("inbox mark delivered failed: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn notice_inbox_cleanup(app: AppHandle, now: i64) -> Result<u64, String> {
    let db = get_db(&app)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let deleted = conn
        .execute(
            "DELETE FROM notice_inbox WHERE expires_at <= ?1 OR delivered = 1",
            params![now],
        )
        .map_err(|e| format!("inbox cleanup failed: {}", e))?;
    Ok(deleted as u64)
}
