import { createClient } from "npm:@supabase/supabase-js@2";

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
const SUCURSAL = (Deno.env.get("SIMPLEFACTURA_SUCURSAL") ?? "Casa Matriz").replace(/\s+/g, "_");
const ACTECO = Number(Deno.env.get("SIMPLEFACTURA_ACTECO") ?? "477397");
const EMISOR = {
  RUTEmisor: Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "78181331-1",
  RznSoc: Deno.env.get("SIMPLEFACTURA_RZN") ?? "CHILESYSTEMS SPA",
  GiroEmis: Deno.env.get("SIMPLEFACTURA_GIRO") ?? "Desarrollo de software",
  Acteco: [ACTECO],
  DirOrigen: Deno.env.get("SIMPLEFACTURA_DIR") ?? "Calle 7 numero 3",
  CmnaOrigen: Deno.env.get("SIMPLEFACTURA_CMNA") ?? "Santiago",
};
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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const raw = (await r.text()).trim();
  if (raw.startsWith("{")) { try { const o = JSON.parse(raw); return o.accessToken ?? o.token ?? o.data ?? raw; } catch { /* noop */ } }
  return raw.replace(/^"|"$/g, "");
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { credit_note_id } = await req.json();
    if (!credit_note_id) return json({ status: "error", message: "credit_note_id requerido" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: nc, error: e1 } = await admin
      .from("credit_note")
      .select("id,folio,neto,iva,total,reason,cod_ref,dte_status,dte_folio,dte_timbre,sale_id")
      .eq("id", credit_note_id).single();
    if (e1 || !nc) return json({ status: "error", message: "nota de crédito no encontrada" }, 404);

    if (nc.dte_status === "emitida" && nc.dte_folio) {
      return json({ status: "emitida", folio: nc.dte_folio, timbre_png: nc.dte_timbre });
    }
    if (!nc.sale_id) return json({ status: "error", message: "la NC no referencia una boleta" }, 400);

    // Documento referenciado: necesita el folio SII y su fecha de emisión.
    const { data: sale, error: e2 } = await admin
      .from("sale").select("doc_type,dte_folio,emitted_at,customer_id").eq("id", nc.sale_id).single();
    if (e2 || !sale) return json({ status: "error", message: "documento no encontrado" }, 404);
    if (!sale.dte_folio) return json({ status: "error", message: "el documento no está emitido en el SII" }, 409);

    const esFactura = sale.doc_type === "factura";
    let receptor: Record<string, unknown> = {
      RUTRecep: "66666666-6", RznSocRecep: "Cliente sin especificar",
      DirRecep: "Ciudad", CmnaRecep: "Santiago", CiudadRecep: "Santiago",
    };
    if (esFactura) {
      if (!sale.customer_id) return json({ status: "error", message: "la factura no tiene cliente para la NC" }, 400);
      const { data: cust, error: e3 } = await admin
        .from("customer").select("rut,razon_social,giro,direccion,comuna").eq("id", sale.customer_id).single();
      if (e3 || !cust || !cust.rut || !cust.razon_social || !cust.giro || !cust.direccion || !cust.comuna) {
        return json({ status: "error", message: "el cliente de la factura no tiene datos tributarios completos para la NC" }, 400);
      }
      const rutDashed = (() => { const l = cust.rut.replace(/[.\-]/g, ""); return `${l.slice(0, -1)}-${l.slice(-1).toUpperCase()}`; })();
      receptor = {
        RUTRecep: rutDashed, RznSocRecep: cust.razon_social, GiroRecep: cust.giro,
        DirRecep: cust.direccion, CmnaRecep: cust.comuna, CiudadRecep: cust.comuna,
      };
    }
    const tpoDocRef = esFactura ? "33" : "39";

    const codRef = nc.cod_ref ?? 1;
    const fchRef = sale.emitted_at ? isoDate(new Date(sale.emitted_at)) : isoDate(new Date());
    const docLabel = esFactura ? "FACTURA ELECTRONICA" : "BOLETA ELECTRONICA";
    const razon = codRef === 1 ? `ANULA ${docLabel}` : "DEVOLUCION MERCADERIA";

    const body = {
      Documento: {
        Encabezado: {
          IdDoc: { TipoDTE: 61, FchEmis: isoDate(new Date()), FchVenc: isoDate(new Date()), FmaPago: 1 },
          Emisor: EMISOR,
          Receptor: receptor,
          Totales: { MntNeto: String(nc.neto), TasaIVA: "19", IVA: String(nc.iva), MntTotal: String(nc.total) },
        },
        Detalle: [{
          NroLinDet: "1",
          NmbItem: `${razon} N ${sale.dte_folio}`,
          QtyItem: "1", PrcItem: String(nc.neto), MontoItem: String(nc.neto),
        }],
        Referencia: [{
          NroLinRef: 1, TpoDocRef: tpoDocRef, FolioRef: String(sale.dte_folio),
          FchRef: fchRef, CodRef: codRef, RazonRef: nc.reason ?? razon,
        }],
      },
    };

    const emit = await fetch(`${SF_URL}/invoiceCreditDebitNotesV2/${SUCURSAL}/${codRef}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await sfToken()}` },
      body: JSON.stringify(body),
    });
    const emitText = await emit.text();
    if (!emit.ok) {
      await admin.from("credit_note").update({ dte_status: "error" }).eq("id", credit_note_id);
      return json({ status: "error", message: `emision ${emit.status}: ${emitText}` }, 502);
    }
    const emitJson = JSON.parse(emitText);
    const folio = emitJson?.data?.folio;
    if (!folio) {
      await admin.from("credit_note").update({ dte_status: "rechazada" }).eq("id", credit_note_id);
      return json({ status: "rechazada", message: emitJson?.message ?? "sin folio" }, 200);
    }

    let timbre_png: string | null = null;
    try {
      const token = await sfToken();
      const tr = await fetch(`${SF_URL}/dte/timbre`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          credenciales: { rutEmisor: EMISOR.RUTEmisor },
          dteReferenciadoExterno: { folio, codigoTipoDte: 61, ambiente: SF_AMBIENTE },
        }),
      });
      if (tr.ok) timbre_png = JSON.parse(await tr.text())?.data ?? null;
    } catch (_) { /* noop */ }

    await admin.from("credit_note").update({
      dte_status: "emitida", dte_folio: folio, dte_timbre: timbre_png, emitted_at: new Date().toISOString(),
    }).eq("id", credit_note_id);

    return json({ status: "emitida", folio, timbre_png });
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});
