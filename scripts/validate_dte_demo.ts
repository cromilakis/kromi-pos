// Validación del DTE contra la cuenta DEMO (ambiente 0). NO usar en producción.
// Ejecutar: npx tsx scripts/validate_dte_demo.ts
import { buildDetalle } from "../supabase/functions/issue-receipt/detalle.ts";

const SF = "https://api.simplefactura.cl";
const EMAIL = "demo@chilesystems.com", PASS = "Rv8Il4eV";
const SUC = "Casa_Matriz", RUT = "78181331-1";

async function token(): Promise<string> {
  const r = await fetch(`${SF}/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const t = (await r.text()).trim();
  const o = JSON.parse(t);
  return o.accessToken ?? o.token ?? o.data;
}

async function main() {
  // Venta de ejemplo: 2 líneas, una con dcto de línea, + descuento global 1799.
  const lines = [
    { name_snapshot: "Suculenta grande", price_snapshot: 5000, qty: 2, discount_amount: 1000 },
    { name_snapshot: "Marantha", price_snapshot: 8990, qty: 1 },
  ];
  const discountAmount = 1799;
  const detalle = buildDetalle(lines, discountAmount, false);
  const total = detalle.reduce((s, d) => s + Number(d.MontoItem), 0);
  const neto = Math.round(total / 1.19);
  const iva = total - neto;

  const body = {
    Documento: {
      Encabezado: {
        IdDoc: { TipoDTE: 39, FchEmis: "2026-07-18", FchVenc: "2026-07-18", IndServicioBoleta: 3 },
        Emisor: { RUTEmisor: RUT, RznSocEmisor: "CHILESYSTEMS SPA", GiroEmisor: "Desarrollo de software", DirOrigen: "Calle 7 numero 3", CmnaOrigen: "Santiago" },
        Receptor: { RUTRecep: "66666666-6", RznSocRecep: "Consumidor Final", DirRecep: "Ciudad", CmnaRecep: "Santiago", CiudadRecep: "Santiago" },
        Totales: { MntNeto: String(neto), IVA: String(iva), MntTotal: String(total) },
      },
      Detalle: detalle,
    },
  };

  const tk = await token();
  const emit = await fetch(`${SF}/invoiceV2/${SUC}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
  const ej = JSON.parse(await emit.text());
  const folio = ej?.data?.folio;
  console.log("emit", emit.status, "folio", folio, "total", total, "msg", ej?.message);
  if (!folio) return;
  console.log("Revisar estado SII con la traza (dte/trazasIssued) en unos minutos; esperar 'Aceptado' SIN reparo.");
}

main();
