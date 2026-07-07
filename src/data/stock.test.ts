import { describe, it, expect } from "vitest";
import { mapProductsWithStock } from "./stock";

describe("mapProductsWithStock", () => {
  it("une producto con su stock de la sucursal (0 si no hay fila)", () => {
    const products = [{ id: "p1", name: "Monstera", category_id: "c1", price: 14990, min_stock: 2, critical: false, img_url: null, supplier_id: null }];
    const inv = [{ product_id: "p1", stock: 5 }];
    expect(mapProductsWithStock(products as any, inv as any)[0].stock).toBe(5);
    expect(mapProductsWithStock(products as any, [] as any)[0].stock).toBe(0);
  });
});
