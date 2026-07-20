import { describe, it, expect } from "vitest";
import { mapProductsWithStock, findByBarcode, type ProductRow } from "./stock";

describe("mapProductsWithStock", () => {
  it("une producto con su stock de la sucursal (0 si no hay fila)", () => {
    const products = [{ id: "p1", name: "Monstera", category_id: "c1", price: 14990, min_stock: 2, critical: false, img_url: null }];
    const inv = [{ product_id: "p1", stock: 5 }];
    expect(mapProductsWithStock(products as any, inv as any)[0].stock).toBe(5);
    expect(mapProductsWithStock(products as any, [] as any)[0].stock).toBe(0);
  });

  it("propaga is_service", () => {
    const products = [{ id: "s1", name: "Visita", category_id: null, price: 20000, min_stock: 0, critical: false, img_url: null, internal_code: null, barcode: null, discount_pct: 0, is_service: true }];
    expect(mapProductsWithStock(products as any, [] as any)[0].is_service).toBe(true);
  });
});

function p(id: string, barcode: string | null): ProductRow {
  return { id, name: id, category_id: null, price: 0, min_stock: 0, critical: false, img_url: null, internal_code: null, barcode, discount_pct: 0, stock: 0, is_service: false };
}

describe("findByBarcode", () => {
  const products = [p("a", "7801234500001"), p("b", null), p("c", "0099")];

  it("encuentra el producto por barcode exacto (con trim)", () => {
    expect(findByBarcode(products, "7801234500001")?.id).toBe("a");
    expect(findByBarcode(products, "  0099 ")?.id).toBe("c");
  });

  it("devuelve undefined si no hay match o el código es vacío", () => {
    expect(findByBarcode(products, "9999")).toBeUndefined();
    expect(findByBarcode(products, "")).toBeUndefined();
    expect(findByBarcode(products, "   ")).toBeUndefined();
  });
});
