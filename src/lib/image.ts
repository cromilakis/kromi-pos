import { supabase } from "@/lib/supabase";

/** Escala (w,h) para que el lado mayor sea `max`, sin ampliar si ya es menor. */
export function scaleDimensions(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Redimensiona y comprime una imagen a WebP usando canvas. */
export function processImage(file: File, max: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const { w, h } = scaleDimensions(img.naturalWidth, img.naturalHeight, max);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error("No se pudo procesar la imagen.")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("No se pudo convertir la imagen."));
        },
        "image/webp",
        0.8,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Archivo de imagen inválido.")); };
    img.src = url;
  });
}

async function uploadTo(path: string, blob: Blob): Promise<string> {
  const { error } = await supabase.storage.from("media").upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw error;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}

export async function uploadProductImage(businessId: string, blob: Blob): Promise<string> {
  return uploadTo(`${businessId}/products/${crypto.randomUUID()}.webp`, blob);
}

export async function uploadLogoImage(businessId: string, blob: Blob): Promise<string> {
  return uploadTo(`${businessId}/logo-${crypto.randomUUID()}.webp`, blob);
}
