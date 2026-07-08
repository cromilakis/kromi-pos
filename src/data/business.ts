import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface BusinessRow {
  id: string;
  name: string;
  nombre_comercial: string | null;
  rut: string;
  giro: string | null;
  direccion: string | null;
  tagline: string | null;
  footer: string | null;
  logo_url: string | null;
  social_red: string | null;
  social_url: string | null;
}

const COLS = "id,name,nombre_comercial,rut,giro,direccion,tagline,footer,logo_url,social_red,social_url";

export function useBusiness(businessId?: string) {
  return useQuery({
    queryKey: ["business", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<BusinessRow> => {
      const { data, error } = await supabase.from("business").select(COLS).eq("id", businessId!).single();
      if (error) throw error;
      return data as BusinessRow;
    },
  });
}

export async function updateBusiness(id: string, patch: Partial<Omit<BusinessRow, "id">>) {
  const { error } = await supabase.from("business").update(patch).eq("id", id);
  if (error) throw error;
}

/** Objeto `social` del payload ESC/POS. `etiqueta` reutiliza el nombre de la red. */
interface NegocioSocial { red: string; url: string; etiqueta: string; }

/** Mapea la fila `business` al objeto `Negocio` que espera el payload de impresión
 *  (ver src-tauri/src/escpos.rs). `printerName` se inyecta aparte (config local). */
export function businessToNegocio(b: BusinessRow | undefined, printerName: string) {
  const social: NegocioSocial | null =
    b?.social_red && b?.social_url ? { red: b.social_red, url: b.social_url, etiqueta: `@${b.social_red}` } : null;
  return {
    nombre_comercial: b?.nombre_comercial ?? "",
    razon_social: b?.name ?? "",
    rut: b?.rut ?? "",
    giro: b?.giro ?? "",
    direccion: b?.direccion ?? "",
    footer: b?.footer ?? "",
    printer_name: printerName,
    social,
  };
}
