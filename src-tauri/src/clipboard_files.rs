// Read absolute file system paths currently held on the system clipboard.
//
// Why this exists: the browser's `ClipboardEvent` sandbox never exposes the
// source file's real path — pasting a file from Finder/Explorer in the web
// layer only yields a `File` object (name + bytes) or a string fallback. To
// give Cmd/Ctrl+V the same semantics as drag-and-drop (which already gets
// real OS paths via `TauriEvent::DRAG_DROP`), we read the native pasteboard
// directly here.
//
// Returns an empty Vec when the clipboard does not contain file references,
// so the frontend can transparently fall back to bitmap handling (e.g.
// screenshots taken with Cmd+Shift+Ctrl+4 which only carry image data).

#[tauri::command]
pub fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::read()
    }
    #[cfg(target_os = "windows")]
    {
        windows_impl::read()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(Vec::new())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};

    pub fn read() -> Result<Vec<String>, String> {
        // SAFETY: NSPasteboard / NSPasteboardItem must be touched on the main
        // thread. Tauri commands run on the Tokio runtime by default, but the
        // pasteboard API is documented as thread-safe for the general
        // pasteboard's read accessors. We rely on that here — if Apple ever
        // tightens this, switch to `tauri::async_runtime::spawn` onto the
        // main thread.
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            let Some(items) = pb.pasteboardItems() else {
                return Ok(Vec::new());
            };

            let mut out = Vec::new();
            for item in items.iter() {
                let Some(url_ns) = item.stringForType(NSPasteboardTypeFileURL) else {
                    continue;
                };
                let raw = url_ns.to_string();
                if let Some(path) = file_url_to_path(&raw) {
                    out.push(path);
                }
            }
            Ok(out)
        }
    }

    /// Convert a `file://` URL string into a plain filesystem path.
    /// Handles percent-encoding (NSPasteboardTypeFileURL strings are encoded).
    fn file_url_to_path(url: &str) -> Option<String> {
        let rest = url
            .strip_prefix("file://localhost")
            .or_else(|| url.strip_prefix("file://"))?;
        // After "file://" the next char is "/" for absolute paths.
        Some(percent_decode(rest))
    }

    fn percent_decode(s: &str) -> String {
        let bytes = s.as_bytes();
        let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let (Some(h), Some(l)) = (hex_nibble(bytes[i + 1]), hex_nibble(bytes[i + 2])) {
                    out.push(h * 16 + l);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    fn hex_nibble(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use std::os::windows::ffi::OsStringExt;
    use std::ffi::OsString;
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

    pub fn read() -> Result<Vec<String>, String> {
        // SAFETY: each Win32 call is documented; we always pair OpenClipboard
        // with CloseClipboard and never hold GetClipboardData's handle past
        // the closing call.
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP.0 as u32).is_err() {
                return Ok(Vec::new());
            }
            if OpenClipboard(HWND(std::ptr::null_mut())).is_err() {
                return Err("OpenClipboard failed".into());
            }

            let result = (|| -> Result<Vec<String>, String> {
                let handle: HANDLE = GetClipboardData(CF_HDROP.0 as u32)
                    .map_err(|e| format!("GetClipboardData(CF_HDROP) failed: {e}"))?;
                let hdrop = HDROP(handle.0);

                // Pass 0xFFFFFFFF to get the file count.
                let count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
                let mut out = Vec::with_capacity(count as usize);
                for i in 0..count {
                    // First call: query needed buffer size (chars, excluding NUL).
                    let needed = DragQueryFileW(hdrop, i, None);
                    if needed == 0 {
                        continue;
                    }
                    let mut buf: Vec<u16> = vec![0u16; (needed as usize) + 1];
                    let written = DragQueryFileW(hdrop, i, Some(buf.as_mut_slice()));
                    if written == 0 {
                        continue;
                    }
                    buf.truncate(written as usize);
                    let s = OsString::from_wide(&buf).to_string_lossy().into_owned();
                    out.push(s);
                }
                Ok(out)
            })();

            let _ = CloseClipboard();
            result
        }
    }
}
