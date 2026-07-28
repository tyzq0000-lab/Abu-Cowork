/**
 * Probe whether a command exists on the user's machine (`where` / `which`).
 *
 * 员工包会在 manifest 里声明「我需要机器上装了 node」这类依赖。以前扶摇**根本不查**，
 * 一律当成"没准备好"，于是任何声明了非 Python 依赖的员工，部署弹窗的确认按钮永远
 * 是灰的 —— 装没装 node 都一样灰。这里补上真实探测，让"缺什么"变成一句能照做的话。
 */
import { invoke } from '@tauri-apps/api/core';
import { isWindows } from './platform';

interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * 命令名来自员工包声明（第三方内容），只允许像命令名的字符串。
 * 虽然走 argv 而非 shell，多一道白名单避免把奇怪的东西当程序名拉起来。
 */
const SAFE_COMMAND_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

// 一次会话内缓存：部署弹窗会反复重算依赖状态，没必要每次都 spawn 一个进程。
const probeCache = new Map<string, boolean>();

export async function hasCommand(name: string): Promise<boolean> {
  const key = name.trim();
  if (!SAFE_COMMAND_NAME.test(key)) return false;

  const cached = probeCache.get(key);
  if (cached !== undefined) return cached;

  // 探测本身失败（命令不可用/超时）→ 当作没装。宁可提示用户去装，
  // 也好过放行之后员工开工第一步才崩。
  const found = await invoke<CommandOutput>('run_argv_command', {
    program: isWindows() ? 'where' : 'which',
    args: [key],
    timeout: 5,
  })
    .then((output) => output.code === 0 && output.stdout.trim().length > 0)
    .catch(() => false);

  probeCache.set(key, found);
  return found;
}

/** 探测所有命令类依赖，返回 { 命令名: 是否存在 }。 */
export async function probeCommands(names: string[]): Promise<Record<string, boolean>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const results = await Promise.all(unique.map(async (n) => [n, await hasCommand(n)] as const));
  return Object.fromEntries(results);
}

/** 用户装完依赖后点「重新检查」用。 */
export function clearCommandProbeCache(): void {
  probeCache.clear();
}
