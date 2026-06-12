import { writeTextFile, mkdir, remove } from '@tauri-apps/plugin-fs';
import { DATA_DIR_NAME } from '@/core/branding';
import { homeDir } from '@tauri-apps/api/path';
import { joinPath, getParentDir } from '@/utils/pathUtils';

/**
 * Save a skill or agent .md file to ~/.uprow/{folder}/{name}/{fileName}.
 * If `oldFilePath` is provided and the name changed, removes the old directory.
 */
export async function saveItemToAbuDir(
  folder: 'skills' | 'agents',
  fileName: 'SKILL.md' | 'AGENT.md',
  name: string,
  mdContent: string,
  oldFilePath?: string,
): Promise<void> {
  const home = await homeDir();
  const targetDir = joinPath(home, DATA_DIR_NAME, folder, name);
  await mkdir(targetDir, { recursive: true });
  await writeTextFile(joinPath(targetDir, fileName), mdContent);

  // If renamed, remove old directory
  if (oldFilePath) {
    const oldDir = getParentDir(oldFilePath);
    if (oldDir !== targetDir) {
      await remove(oldDir, { recursive: true }).catch(() => {/* ignore if already gone */});
    }
  }
}
