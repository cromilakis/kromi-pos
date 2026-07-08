import { createClient } from "@supabase/supabase-js";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// CORS: el WebView de Tauri (y el navegador en dev) hace preflight OPTIONS a la
// función; sin estos headers el fetch falla con "Failed to send a request".
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Esquema de extraccion (structured outputs).
const schema = {
  name: "invoice_extraction",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["proveedor", "documento", "lineas"],
    properties: {
      proveedor: { type: "object", additionalProperties: false, required: ["razon_social", "rut", "giro", "direccion"],
        properties: { razon_social: { type: "string", description: "Razón social / nombre del PROVEEDOR EMISOR (quien emite y vende), en el encabezado superior del documento. NUNCA el nombre del receptor/cliente (bloque 'Señor(es):')." },
          rut: { type: "string", description: "RUT del PROVEEDOR EMISOR tal cual aparece impreso, con puntos y guión (ej: 78.964.380-6). Está en el recuadro-timbre destacado (frecuentemente en rojo) de una esquina, junto al folio, con el formato 'R.U.T. <número>'. NO es el RUT del receptor/cliente. Obligatorio: no lo dejes vacío si aparece." },
          giro: { type: "string", description: "Giro / actividad económica del PROVEEDOR EMISOR, en el párrafo o líneas debajo del nombre del emisor en el encabezado superior (normalmente SIN rótulo 'Giro:'). NUNCA el giro del receptor/cliente (bloque 'Señor(es):' que sí lo rotula). Vacío solo si no aparece." },
          direccion: { type: "string", description: "Dirección del PROVEEDOR EMISOR (encabezado superior, bajo el nombre y el giro). NUNCA la dirección del receptor/cliente. Vacío solo si no aparece." } } },
      documento: { type: "object", additionalProperties: false, required: ["tipo", "folio", "fecha", "neto", "iva", "total"],
        properties: { tipo: { type: "string", description: "Tipo de documento, tal como aparece en el recuadro-timbre destacado (ej: 'Factura Electrónica')." },
          folio: { type: "string", description: "Folio/número del documento: el número que sigue a 'N°' en el recuadro-timbre destacado (ej: 59763). Obligatorio: no lo dejes vacío si aparece en el documento." },
          fecha: { type: "string", description: "Fecha de emisión del documento en formato ISO 8601 YYYY-MM-DD (ej: 2026-07-02). Nunca dd/mm/yyyy." },
          neto: { type: "number" }, iva: { type: "number" }, total: { type: "number" } } },
      lineas: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["supplier_code", "description", "qty", "unit_cost", "line_total"],
        properties: { supplier_code: { type: "string" }, description: { type: "string" },
          qty: { type: "number" }, unit_cost: { type: "number" }, line_total: { type: "number" } } } },
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    // Cliente con el JWT del usuario (para resolver su business_id vía RLS/RPC).
    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const form = await req.formData();
    const file = form.get("file") as File;
    if (!file) return json({ error: "Falta el archivo 'file'." }, 400);

    // business_id del usuario autenticado
    const { data: prof } = await supa.from("app_user").select("business_id").maybeSingle();
    const businessId = prof?.business_id;
    if (!businessId) return json({ error: "Usuario sin negocio." }, 403);

    // Subir el PDF a Storage
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdfPath = `${businessId}/${crypto.randomUUID()}.pdf`;
    const up = await admin.storage.from("purchase-invoices").upload(pdfPath, bytes, { contentType: "application/pdf" });
    if (up.error) return json({ error: "No se pudo archivar el PDF." }, 500);

    // Subir el PDF a OpenAI Files → file_id
    const oaForm = new FormData();
    oaForm.append("purpose", "user_data");
    oaForm.append("file", new Blob([bytes], { type: "application/pdf" }), "factura.pdf");
    const upf = await fetchWithTimeout("https://api.openai.com/v1/files", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: oaForm }, 60000);
    const upfJson = await upf.json();
    if (!upf.ok) return json({ error: "OpenAI files: " + JSON.stringify(upfJson) }, 502);
    const fileId = upfJson.id;

    // Responses API con input_file + structured outputs
    const resp = await fetchWithTimeout("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5-nano",
        reasoning: { effort: "minimal" },
        input: [{ role: "user", content: [
          { type: "input_text", text: "Extrae los datos de esta factura de compra chilena en el formato indicado. Montos en pesos (enteros, sin separadores).\n\nCLAVE — distingue EMISOR de RECEPTOR:\n- El PROVEEDOR es el EMISOR (quien vende y emite el documento). Sus datos están en el ENCABEZADO SUPERIOR: su nombre/razón social y, en el párrafo o líneas INMEDIATAMENTE DEBAJO del nombre, su giro (actividad económica) y su dirección. Esta info del emisor normalmente NO está rotulada con etiquetas.\n- El RECEPTOR/CLIENTE es el comprador (nosotros) y aparece en un bloque APARTE, frecuentemente rotulado 'Señor(es):' o 'Cliente', con sus propios 'R.U.T.:', 'Giro:', 'Dirección:', 'Comuna:'. IGNORA por completo ese bloque: NO lo uses para proveedor.razon_social, proveedor.rut, proveedor.giro ni proveedor.direccion.\n- Regla práctica: si un dato viene rotulado con 'Giro:' o 'Dirección:' dentro del bloque del cliente, NO es del proveedor. El giro y la dirección del proveedor son el texto libre bajo su nombre en el encabezado.\n\nEl RUT del EMISOR y el folio/número del documento aparecen JUNTOS en un recuadro-timbre destacado (frecuentemente en rojo) en una ESQUINA (normalmente arriba a la derecha), con el formato 'R.U.T. <número con puntos y guión>', 'FACTURA ELECTRONICA' (o el tipo de documento) y 'N° <folio>'. Extrae SIEMPRE ese RUT del emisor (ej. 78.964.380-6) y ese folio (el número que sigue a 'N°', ej. 59763); ambos son obligatorios. documento.tipo es el texto de ese recuadro (ej. 'Factura Electrónica').\n\nLa fecha de emisión suele venir como dd/mm/yyyy: conviértela y devuélvela SIEMPRE en ISO 8601 YYYY-MM-DD (ej: 02/07/2026 -> 2026-07-02)." },
          { type: "input_file", file_id: fileId },
        ] }],
        text: { format: { type: "json_schema", ...schema } },
      }),
    }, 120000);
    const respJson = await resp.json();
    if (!resp.ok) return json({ error: "OpenAI responses: " + JSON.stringify(respJson) }, 502);

    // Extraer el JSON del output
    const text = respJson.output_text
      ?? respJson.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === "output_text")?.text;
    const extraction = JSON.parse(text);

    return json({ pdf_path: pdfPath, extraction }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

// fetch con timeout: si OpenAI no responde a tiempo, aborta y la función
// devuelve error en vez de quedarse colgada indefinidamente.
async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
