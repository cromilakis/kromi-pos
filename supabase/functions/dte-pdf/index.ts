import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
const RUT_EMISOR = Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "78181331-1";
// Nombre de la sucursal: a diferencia de /invoiceV2 (URL, espacios -> "_"), /dte/pdf va
// en el body y espera el valor tal cual (con espacios).
const SUCURSAL = Deno.env.get("SIMPLEFACTURA_SUCURSAL") ?? "Casa Matriz";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function sfToken(): Promise<string> {
  const r = await fetch(`${SF_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const raw = (await r.text()).trim();
  if (raw.startsWith("{")) { try { const o = JSON.parse(raw); return o.accessToken ?? o.token ?? o.data ?? raw; } catch { /* noop */ } }
  return raw.replace(/^"|"$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sale_id } = await req.json();
    if (!sale_id) return json({ status: "error", message: "sale_id requerido" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: sale, error: e1 } = await admin
      .from("sale")
      .select("id,folio,doc_type,dte_status,dte_folio")
      .eq("id", sale_id).single();
    if (e1 || !sale) return json({ status: "error", message: "venta no encontrada" }, 404);

    if (sale.dte_status !== "emitida" || !sale.dte_folio) {
      return json({ status: "error", message: "la venta no está emitida" }, 400);
    }

    const codigoTipoDte = sale.doc_type === "factura" ? 33 : 39;

    const token = await sfToken();
    const resp = await fetch(`${SF_URL}/dte/pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        credenciales: { rutEmisor: RUT_EMISOR, nombreSucursal: SUCURSAL },
        dteReferenciadoExterno: { folio: sale.dte_folio, codigoTipoDte, ambiente: SF_AMBIENTE, cedible: false },
      }),
    });

    if (!resp.ok) {
      return json({ status: "error", message: (await resp.text()) || resp.statusText }, 502);
    }

    const bytes = new Uint8Array(await resp.arrayBuffer());
    const pdf_base64 = encodeBase64(bytes);
    return json({ status: "ok", pdf_base64 });
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});
