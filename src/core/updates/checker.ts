import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useSettingsStore } from '@/stores/settingsStore';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface UpdateInfo {
  version: string;
  releaseNotes: string;
  publishedAt: string;
}

let _pendingUpdate: Update | null = null;

export async function checkForUpdate(force = false): Promise<UpdateInfo | null> {
  const store = useSettingsStore.getState();

  if (!force) {
    const elapsed = Date.now() - store.lastUpdateCheck;
    if (elapsed < CHECK_INTERVAL_MS) return null;
  }

  store.setUpdateChecking(true);

  try {
    const update = await check();
    store.setLastUpdateCheck(Date.now());

    if (!update) {
      store.setUpdateInfo(null);
      _pendingUpdate = null;
      return null;
    }

    _pendingUpdate = update;

    const info: UpdateInfo = {
      version: update.version.replace(/^v/, ''),
      releaseNotes: update.body ?? '',
      publishedAt: update.date ?? '',
    };

    store.setUpdateInfo(info);
    return info;
  } catch (err) {
    console.warn('[Update] Check failed:', err);
    return null;
  } finally {
    store.setUpdateChecking(false);
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  if (!_pendingUpdate) throw new Error('No pending update');

  const store = useSettingsStore.getState();

  try {
    let downloaded = 0;
    let contentLength = 0;

    await _pendingUpdate.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? 0;
          store.setUpdateDownloadProgress({ downloaded: 0, total: contentLength });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          store.setUpdateDownloadProgress({ downloaded, total: contentLength });
          break;
        case 'Finished':
          store.setUpdateDownloadProgress(null);
          break;
      }
    });

    store.setUpdateInstalling(true);
  } catch (err) {
    store.setUpdateDownloadProgress(null);
    store.setUpdateInstalling(false);
    throw err;
  }
}

export async function restartApp(): Promise<void> {
  await relaunch();
}
