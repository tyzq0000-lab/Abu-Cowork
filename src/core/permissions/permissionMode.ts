/**
 * Permission Mode System — controls tool execution confirmation behavior.
 *
 * Three modes:
 * - default: Dangerous commands require confirmation. File writes to new directories require permission.
 *            This matches the existing behavior exactly.
 * - auto:    Read-only operations auto-proceed. Write operations and dangerous commands still require confirmation.
 * - strict:  ALL tool operations require user confirmation before execution.
 */

import type { ConfirmationInfo } from '../tools/registry';

/** Permission mode determines which tool operations require user confirmation */
export type PermissionMode = 'default' | 'auto' | 'strict';

/**
 * Strategy interface for permission decisions.
 * Each mode implements this to decide whether a tool call needs confirmation.
 */
export interface PermissionStrategy {
  /**
   * Should this command require confirmation?
   * Called for run_command tool only.
   */
  shouldConfirmCommand(info: ConfirmationInfo, readOnly: boolean): boolean;

  /**
   * Should this file operation require permission?
   * Called for file tools (read_file, write_file, edit_file, etc.)
   */
  shouldConfirmFileAccess(capability: 'read' | 'write', needsPermission: boolean): boolean;

  /**
   * Should this MCP/other tool require confirmation?
   * Called for tools that aren't commands or file tools.
   */
  shouldConfirmOtherTool(): boolean;
}

/** Default mode: matches existing behavior — only dangerous/warn commands need confirmation */
const defaultStrategy: PermissionStrategy = {
  shouldConfirmCommand(info, _readOnly) {
    return info.level === 'danger' || info.level === 'warn';
  },
  shouldConfirmFileAccess(_capability, needsPermission) {
    return needsPermission;
  },
  shouldConfirmOtherTool() {
    return false;
  },
};

/** Auto mode: read-only operations auto-proceed, writes still need confirmation */
const autoStrategy: PermissionStrategy = {
  shouldConfirmCommand(info, readOnly) {
    // Read-only commands auto-proceed regardless of danger level analysis
    if (readOnly) return false;
    // Non-read-only: same as default
    return info.level === 'danger' || info.level === 'warn';
  },
  shouldConfirmFileAccess(capability, needsPermission) {
    // Read operations auto-proceed even for new directories
    if (capability === 'read') return false;
    // Write operations still need permission for new directories
    return needsPermission;
  },
  shouldConfirmOtherTool() {
    return false;
  },
};

/** Strict mode: ALL tool operations require confirmation */
const strictStrategy: PermissionStrategy = {
  shouldConfirmCommand() {
    return true;
  },
  shouldConfirmFileAccess() {
    return true;
  },
  shouldConfirmOtherTool() {
    return true;
  },
};

/**
 * Get the permission strategy for a given mode.
 */
export function getPermissionStrategy(mode: PermissionMode): PermissionStrategy {
  switch (mode) {
    case 'auto': return autoStrategy;
    case 'strict': return strictStrategy;
    case 'default':
    default: return defaultStrategy;
  }
}
