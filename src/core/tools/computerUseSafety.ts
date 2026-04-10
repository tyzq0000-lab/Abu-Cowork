/**
 * Computer Use safety checks — sensitive app blocking and dangerous key interception.
 *
 * Prevents the model from:
 * 1. Interacting with sensitive apps (keychain, terminal, system settings)
 * 2. Pressing dangerous key combos (Cmd+Q, Alt+F4, etc.)
 */

import { isMacOS } from '../../utils/platform';

// ─── Sensitive App Blocklist (by bundle ID) ───

/** macOS apps that should not be operated via Computer Use */
const SENSITIVE_BUNDLE_IDS_MACOS = new Set([
  // Security & system
  'com.apple.keychainaccess',          // Keychain Access
  'com.apple.systempreferences',       // System Preferences (legacy)
  'com.apple.systemsettings',          // System Settings (macOS 13+)
  'com.apple.ActivityMonitor',         // Activity Monitor
  'com.apple.DiskUtility',            // Disk Utility

  // Terminals — commands should use run_command tool, not GUI terminal
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'com.microsoft.VSCodeInsiders',      // VS Code terminal
  'dev.warp.Warp',
  'com.github.alacritty',

  // Communication — risk of sending unintended messages
  'com.tencent.xinWeChat',             // WeChat
  'com.apple.MobileSMS',              // Messages
  'com.apple.mail',                    // Mail
  'com.microsoft.Outlook',
  'com.tinyspeck.slackmacgap',        // Slack
  'us.zoom.xos',                       // Zoom
  'com.hnc.Discord',                   // Discord
  'com.electron.lark',                 // Lark/飞书
  'com.alibaba.DingTalkMac',          // DingTalk/钉钉
  'ru.keepcoder.Telegram',            // Telegram
]);

/** Windows process names that should not be operated */
const SENSITIVE_PROCESS_NAMES_WINDOWS = new Set([
  // Case-insensitive matching applied in check function
  'cmd', 'powershell', 'windowsterminal', 'pwsh',
  'regedit', 'taskmgr', 'mmc',
  'credentialmanager',
]);

/**
 * Check if the foreground app is sensitive and should not be operated.
 * Returns error message if blocked, null if allowed.
 */
export function checkSensitiveApp(bundleId: string | null | undefined, appName: string): string | null {
  if (!bundleId) return null; // Can't check, allow

  if (isMacOS()) {
    if (SENSITIVE_BUNDLE_IDS_MACOS.has(bundleId)) {
      return `安全限制：不允许操控「${appName}」。该应用属于敏感类型（安全/终端/通讯），请使用其他方式完成操作。`;
    }
  } else {
    // Windows: match by process name (case-insensitive)
    if (SENSITIVE_PROCESS_NAMES_WINDOWS.has(bundleId.toLowerCase())) {
      return `安全限制：不允许操控「${appName}」。该应用属于敏感类型，请使用其他方式完成操作。`;
    }
  }

  return null;
}

// ─── Dangerous Key Combo Blocklist ───

/** macOS key combos that should never be sent by the model */
const BLOCKED_KEYS_MACOS = new Set([
  'meta+q',              // Quit frontmost app
  'meta+shift+q',        // Log out
  'alt+meta+escape',     // Force Quit dialog
  'meta+tab',            // App switcher (interferes with CU flow)
  'ctrl+meta+q',         // Lock screen
  'meta+shift+delete',   // Empty Trash
]);

/** Windows key combos that should never be sent */
const BLOCKED_KEYS_WINDOWS = new Set([
  'alt+f4',              // Close window
  'ctrl+alt+delete',     // Security options
  'meta+l',              // Lock screen
  'alt+tab',             // App switcher
]);

/**
 * Check if a key combo is blocked.
 * Returns error message if blocked, null if allowed.
 */
export function checkBlockedKeyCombo(key: string, modifiers?: string[]): string | null {
  // Normalize: sort modifiers alphabetically + lowercase key
  const mods = (modifiers ?? []).map(m => {
    const lower = m.toLowerCase();
    // Normalize aliases
    if (lower === 'cmd' || lower === 'command' || lower === 'super' || lower === 'win') return 'meta';
    if (lower === 'control') return 'ctrl';
    if (lower === 'option') return 'alt';
    return lower;
  }).sort();

  const normalized = [...mods, key.toLowerCase()].join('+');

  const blocklist = isMacOS() ? BLOCKED_KEYS_MACOS : BLOCKED_KEYS_WINDOWS;

  if (blocklist.has(normalized)) {
    return `安全限制：按键组合「${normalized}」被拦截。该组合可能导致系统操作（退出应用/锁屏/注销等），不允许通过 Computer Use 执行。`;
  }

  return null;
}
