import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Busca una actualización disponible. Fuera de Tauri (navegador/tests) retorna null. */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri) return null;
  return await check();
}

/** Descarga e instala la actualización (con progreso) y relanza la app. */
export async function installUpdate(
  update: Update,
  onProgress?: (downloaded: number, total: number | null) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      onProgress?.(downloaded, total);
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress?.(downloaded, total);
    }
  });
  await relaunch();
}
