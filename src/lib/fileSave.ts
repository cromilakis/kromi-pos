import { isTauri } from "@tauri-apps/api/core";

/** Guarda el contenido de una URL en disco.
 *
 *  - En la app Tauri: descarga los bytes y abre el diálogo nativo "Guardar como"
 *    para que el usuario elija carpeta y nombre; los escribe con el comando `save_file`.
 *  - En el navegador (pnpm dev): descarga por <a> (la URL firmada ya fuerza attachment).
 *
 *  Devuelve true si se guardó, false si el usuario canceló el diálogo.
 */
export async function saveUrlAs(url: string, suggestedName: string): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { invoke }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/api/core"),
    ]);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar el archivo`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const ext = suggestedName.includes(".") ? suggestedName.split(".").pop() : undefined;
    const target = await save({
      defaultPath: suggestedName,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined,
    });
    if (!target) return false; // usuario canceló
    await invoke("save_file", { path: target, contents: Array.from(bytes) });
    return true;
  }

  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}

/** Guarda un PDF codificado en base64 (p.ej. el que devuelve la Edge Function `dte-pdf`)
 *  reusando el mismo flujo de guardado que `saveUrlAs` (diálogo nativo en Tauri, descarga
 *  por <a> en el navegador). */
export async function savePdfBase64(base64: string, suggestedName: string): Promise<void> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  try {
    await saveUrlAs(url, suggestedName);
  } finally {
    URL.revokeObjectURL(url);
  }
}
