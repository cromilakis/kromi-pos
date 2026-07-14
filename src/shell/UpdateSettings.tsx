import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installUpdate } from "@/lib/updater";
import { notifyError, errMsg } from "@/lib/errors";

type Status = "idle" | "checking" | "uptodate" | "available" | "installing";

/** Sección de Configuración: versión actual, buscar/instalar actualizaciones (patrón PrinterSettings). */
export function UpdateSettings() {
  const [version, setVersion] = useState("—");
  const [status, setStatus] = useState<Status>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null } | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("—"));
  }, []);

  async function check() {
    setStatus("checking");
    try {
      const u = await checkForUpdate();
      if (u) {
        setUpdate(u);
        setStatus("available");
      } else {
        setStatus("uptodate");
      }
    } catch (e) {
      notifyError("No se pudo buscar actualizaciones.", errMsg(e));
      setStatus("idle");
    }
  }

  async function install() {
    if (!update) return;
    setStatus("installing");
    try {
      await installUpdate(update, (downloaded, total) => setProgress({ downloaded, total }));
    } catch (e) {
      notifyError("No se pudo instalar la actualización.", errMsg(e));
      setStatus("available");
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11.5px] text-[#5E6E7E]">Versión actual: {version}</div>

      <div>
        <button
          type="button"
          onClick={check}
          disabled={status === "checking" || status === "installing"}
          className="rounded-[11px] border border-[#E1E5EE] bg-white px-[18px] py-2.5 text-sm font-bold text-[#2A3A2E] disabled:opacity-70"
        >
          {status === "checking" ? "Buscando…" : "Buscar actualizaciones"}
        </button>
      </div>

      {status === "uptodate" && (
        <div className="text-[13px] text-[#556A7C]">Estás en la última versión.</div>
      )}

      {status === "available" && update && (
        <div className="rounded-[12px] border border-[#E1E5EE] bg-[#F7F8FA] p-3.5">
          <div className="text-[13px] font-bold text-[#0F2A1B]">Nueva versión {update.version}</div>
          {update.body && (
            <div className="mt-1 whitespace-pre-wrap text-[12.5px] text-[#556A7C]">{update.body}</div>
          )}
          <button
            type="button"
            onClick={install}
            className="mt-3 rounded-[11px] px-[18px] py-2.5 text-sm font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            Actualizar ahora
          </button>
        </div>
      )}

      {status === "installing" && (
        <div className="rounded-[12px] border border-[#E1E5EE] bg-[#F7F8FA] p-3.5">
          <div className="mb-2 text-[12.5px] font-bold text-[#5a6b7e]">
            {progress?.total ? `${Math.round((progress.downloaded / progress.total) * 100)}%` : "Descargando…"}
          </div>
          <div className="h-[8px] w-full overflow-hidden rounded-full bg-[#E1E5EE]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                background: "var(--brand)",
                width: progress?.total ? `${Math.round((progress.downloaded / progress.total) * 100)}%` : "35%",
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
