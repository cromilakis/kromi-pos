import { createClient } from "npm:@supabase/supabase-js@2";
import { buildDetalle } from "./detalle.ts";

const SF_URL = Deno.env.get("SIMPLEFACTURA_URL") ?? "https://api.simplefactura.cl";
const SF_EMAIL = Deno.env.get("SIMPLEFACTURA_EMAIL")!;
const SF_PASSWORD = Deno.env.get("SIMPLEFACTURA_PASSWORD")!;
const SF_AMBIENTE = Number(Deno.env.get("SIMPLEFACTURA_AMBIENTE") ?? "0");
// Nombre de la sucursal del emisor (en la URL los espacios van como "_").
const SUCURSAL = (Deno.env.get("SIMPLEFACTURA_SUCURSAL") ?? "Casa Matriz").replace(/\s+/g, "_");
// Emisor: en demo se usa un RUT autorizado por la cuenta demo (no el del negocio real).
// Formato BOLETA (39): RznSocEmisor/GiroEmisor (sin Acteco/CiudadOrigen).
const EMISOR = {
  RUTEmisor: Deno.env.get("SIMPLEFACTURA_RUT_EMISOR") ?? "78181331-1",
  RznSocEmisor: Deno.env.get("SIMPLEFACTURA_RZN") ?? "CHILESYSTEMS SPA",
  GiroEmisor: Deno.env.get("SIMPLEFACTURA_GIRO") ?? "Desarrollo de software",
  DirOrigen: Deno.env.get("SIMPLEFACTURA_DIR") ?? "Calle 7 numero 3",
  CmnaOrigen: Deno.env.get("SIMPLEFACTURA_CMNA") ?? "Santiago",
};
// Formato FACTURA (33): RznSoc/GiroEmis + Acteco (array de códigos) + CiudadOrigen
// (ver skill simplefactura-dte §3.1). Reutiliza RUT/Dir/Cmna del emisor de boleta;
// Acteco y Ciudad son nuevas env vars propias de factura.
const EMISOR_FACTURA = {
  RUTEmisor: EMISOR.RUTEmisor,
  RznSoc: Deno.env.get("SIMPLEFACTURA_RZN") ?? "CHILESYSTEMS SPA",
  GiroEmis: Deno.env.get("SIMPLEFACTURA_GIRO") ?? "Desarrollo de software",
  Acteco: (Deno.env.get("SF_EMISOR_ACTECO") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number),
  DirOrigen: EMISOR.DirOrigen,
  CmnaOrigen: EMISOR.CmnaOrigen,
  CiudadOrigen: Deno.env.get("SF_EMISOR_CIUDAD") ?? "Santiago",
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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SF_EMAIL, password: SF_PASSWORD }),
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const raw = (await r.text()).trim();
  // La API devuelve { "accessToken": "..." }. Tolerar también string plano u otras claves.
  if (raw.startsWith("{")) { try { const o = JSON.parse(raw); return o.accessToken ?? o.token ?? o.data ?? raw; } catch { /* noop */ } }
  return raw.replace(/^"|"$/g, "");
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function isoDate(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

// El RUT se guarda normalizado sin puntos ni guion (ver normRut en el frontend); el SII
// exige el formato cuerpo-DV en RUTRecep. Se limpia por robustez y se inserta el guion
// antes del DV, dejando el DV en mayúscula si es "k".
function formatRutDashed(rut: string): string {
  const limpio = rut.replace(/[.\-]/g, "");
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1).toUpperCase();
  return `${cuerpo}-${dv}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { sale_id } = await req.json();
    if (!sale_id) return json({ status: "error", message: "sale_id requerido" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: sale, error: e1 } = await admin
      .from("sale")
      .select("id,folio,neto,iva,total,discount_amount,points_discount,points_redeemed,doc_type,customer_id,dte_status,dte_folio,dte_timbre,sale_line(name_snapshot,price_snapshot,qty,discount_amount)")
      .eq("id", sale_id).single();
    if (e1 || !sale) return json({ status: "error", message: "venta no encontrada" }, 404);

    // Idempotencia: ya emitida → devolver lo persistido.
    if (sale.dte_status === "emitida" && sale.dte_folio) {
      return json({ status: "emitida", folio: sale.dte_folio, timbre_png: sale.dte_timbre });
    }

    const esFactura = sale.doc_type === "factura";
    const tipoDte = esFactura ? 33 : 39;

    // Factura: requiere el cliente (empresa) para el Receptor real.
    let customer: {
      rut: string | null;
      razon_social: string | null;
      giro: string | null;
      direccion: string | null;
      comuna: string | null;
      ciudad: string | null;
      direccion_despacho: string | null;
      comuna_despacho: string | null;
      contacto: string | null;
      email: string | null;
    } | null = null;
    if (esFactura) {
      if (!sale.customer_id) return json({ status: "error", message: "la factura requiere un cliente" }, 400);
      const { data: cust, error: e2 } = await admin
        .from("customer")
        .select("rut,razon_social,giro,direccion,comuna,ciudad,direccion_despacho,comuna_despacho,contacto,email")
        .eq("id", sale.customer_id).single();
      if (e2 || !cust) return json({ status: "error", message: "cliente no encontrado" }, 404);
      if (!cust.razon_social || !cust.giro || !cust.direccion || !cust.comuna) {
        return json({ status: "error", message: "el cliente empresa no tiene datos tributarios completos para factura" }, 400);
      }
      customer = cust;
    }

    const token = await sfToken();
    const lines = (sale as { sale_line?: Array<{ name_snapshot: string; price_snapshot: number; qty: number; discount_amount?: number }> }).sale_line ?? [];
    // Boleta: precio con IVA incluido (line.discount_amount ya viene con IVA incluido).
    // Factura: detalle en NETO (price_snapshot y descuentos vienen con IVA incluido desde
    // la venta; se llevan a neto dividiendo por 1.19 y redondeando, ver skill §0.5/§3).
    const detalle = buildDetalle(lines, sale.discount_amount ?? 0, esFactura);

    // Totales: boleta usa los ya persistidos (neto/iva/total, con IVA incluido, ya
    // descuentan el global); factura se recalcula en neto desde el detalle (los montos
    // persistidos en sale.* vienen en bruto/IVA-incluido, no sirven para factura).
    let idDoc: Record<string, unknown>;
    let emisor: Record<string, unknown>;
    let receptor: Record<string, unknown>;
    let totales: Record<string, string>;
    if (esFactura) {
      const mntNeto = detalle.reduce((acc, d) => acc + Number(d.MontoItem), 0);
      const ivaFactura = Math.round(mntNeto * 0.19);
      idDoc = { TipoDTE: 33, FchEmis: isoDate(new Date()), FchVenc: isoDate(new Date()), FmaPago: 1 };
      emisor = EMISOR_FACTURA;
      receptor = {
        RUTRecep: formatRutDashed(customer!.rut!),
        RznSocRecep: customer!.razon_social,
        GiroRecep: customer!.giro,
        DirRecep: customer!.direccion,
        CmnaRecep: customer!.comuna,
        ...(customer!.ciudad ? { CiudadRecep: customer!.ciudad } : {}),
        ...(customer!.contacto ? { Contacto: customer!.contacto } : {}),
        ...(customer!.email ? { CorreoRecep: customer!.email } : {}),
      };
      totales = { MntNeto: String(mntNeto), IVA: String(ivaFactura), MntTotal: String(mntNeto + ivaFactura) };
    } else {
      idDoc = { TipoDTE: 39, FchEmis: isoDate(new Date()), FchVenc: isoDate(new Date()), IndServicioBoleta: 3 };
      emisor = EMISOR;
      // Boleta al público: receptor "consumidor final" (RUT 66666666-6).
      receptor = { RUTRecep: "66666666-6", RznSocRecep: "Consumidor Final", DirRecep: "Ciudad", CmnaRecep: "Santiago", CiudadRecep: "Santiago" };
      // MntNeto/IVA/MntTotal ya vienen reducidos por el servidor (descuentan el global);
      // no se recalculan aquí.
      totales = { MntNeto: String(sale.neto), IVA: String(sale.iva), MntTotal: String(sale.total) };
    }

    const body = {
      Documento: {
        Encabezado: {
          IdDoc: idDoc,
          Emisor: emisor,
          Receptor: receptor,
          Totales: totales,
          ...(esFactura && customer!.direccion_despacho
            ? {
                Transporte: {
                  DirDest: customer!.direccion_despacho,
                  ...(customer!.comuna_despacho ? { CmnaDest: customer!.comuna_despacho } : {}),
                  ...(customer!.ciudad ? { CiudadDest: customer!.ciudad } : {}),
                },
              }
            : {}),
        },
        Detalle: detalle,
      },
    };

    const emit = await fetch(`${SF_URL}/invoiceV2/${SUCURSAL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const emitText = await emit.text();
    if (!emit.ok) {
      await admin.from("sale").update({ dte_status: "error" }).eq("id", sale_id);
      return json({ status: "error", message: `emision ${emit.status}: ${emitText}` }, 502);
    }
    const emitJson = JSON.parse(emitText);
    const folio = emitJson?.data?.folio;
    if (!folio) {
      await admin.from("sale").update({ dte_status: "rechazada" }).eq("id", sale_id);
      return json({ status: "rechazada", message: emitJson?.message ?? "sin folio" }, 200);
    }

    // Timbre (PNG base64). Si falla, la boleta ya tiene folio; el timbre se reintenta luego.
    let timbre_png: string | null = null;
    try {
      const tr = await fetch(`${SF_URL}/dte/timbre`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          credenciales: { rutEmisor: EMISOR.RUTEmisor },
          dteReferenciadoExterno: { folio, codigoTipoDte: tipoDte, ambiente: SF_AMBIENTE },
        }),
      });
      if (tr.ok) timbre_png = JSON.parse(await tr.text())?.data ?? null;
    } catch (_) { /* noop */ }

    await admin.from("sale").update({
      dte_status: "emitida", dte_folio: folio, dte_timbre: timbre_png, emitted_at: new Date().toISOString(),
    }).eq("id", sale_id);

    return json({ status: "emitida", folio, timbre_png });
  } catch (err) {
    return json({ status: "error", message: String(err) }, 500);
  }
});
