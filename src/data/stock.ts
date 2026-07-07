import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface ProductRow {
  id: string;
  name: string;
  category_id: string | null;
  price: number;
  min_stock: number;
  critical: boolean;
  img_url: string | null;
  supplier_id: string | null;
  stock: number;
}

export interface CategoryRow {
  id: string;
  key: string;
  label: string;
  dot: string | null;
  tile: string | null;
  pill_bg: string | null;
  pill_fg: string | null;
  sort: number;
}

export interface SupplierRow {
  id: string;
  razon_social: string;
}

/** Combina productos de negocio con su stock en UNA sucursal (0 si no hay fila de inventory). */
export function mapProductsWithStock(
  products: Omit<ProductRow, "stock">[],
  inventory: { product_id: string; stock: number }[],
): ProductRow[] {
  const byId = new Map(inventory.map((i) => [i.product_id, i.stock]));
  return products.map((p) => ({ ...p, stock: byId.get(p.id) ?? 0 }));
}

export function useProductsWithStock(businessId?: string, branchId?: string) {
  return useQuery({
    queryKey: ["products-with-stock", businessId, branchId],
    enabled: !!businessId && !!branchId,
    queryFn: async (): Promise<ProductRow[]> => {
      const [{ data: products, error: e1 }, { data: inv, error: e2 }] = await Promise.all([
        supabase
          .from("product")
          .select("id,name,category_id,price,min_stock,critical,img_url,supplier_id")
          .eq("business_id", businessId!)
          .is("deleted_at", null)
          .order("name"),
        supabase.from("inventory").select("product_id,stock").eq("branch_id", branchId!),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return mapProductsWithStock(products ?? [], inv ?? []);
    },
  });
}

export function useCategories(businessId?: string) {
  return useQuery({
    queryKey: ["categories", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<CategoryRow[]> => {
      const { data, error } = await supabase
        .from("category")
        .select("id,key,label,dot,tile,pill_bg,pill_fg,sort")
        .eq("business_id", businessId!)
        .is("deleted_at", null)
        .order("sort");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSuppliers(businessId?: string) {
  return useQuery({
    queryKey: ["suppliers", businessId],
    enabled: !!businessId,
    queryFn: async (): Promise<SupplierRow[]> => {
      const { data, error } = await supabase
        .from("supplier")
        .select("id,razon_social")
        .eq("business_id", businessId!)
        .is("deleted_at", null)
        .order("razon_social");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export async function createProduct(input: {
  business_id: string;
  name: string;
  category_id: string | null;
  price: number;
  min_stock: number;
  critical: boolean;
  img_url: string | null;
  supplier_id: string | null;
}) {
  const { data, error } = await supabase.from("product").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateProduct(
  id: string,
  input: Partial<{
    name: string;
    category_id: string | null;
    price: number;
    min_stock: number;
    critical: boolean;
    img_url: string | null;
    supplier_id: string | null;
  }>,
) {
  const { error } = await supabase.from("product").update(input).eq("id", id);
  if (error) throw error;
}

export async function softDeleteProduct(id: string) {
  const { error } = await supabase.from("product").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function upsertInventory(productId: string, branchId: string, stock: number) {
  const { error } = await supabase
    .from("inventory")
    .upsert({ product_id: productId, branch_id: branchId, stock }, { onConflict: "product_id,branch_id" });
  if (error) throw error;
}

export async function createCategory(input: {
  business_id: string;
  key: string;
  label: string;
  dot?: string;
  tile?: string;
  pill_bg?: string;
  pill_fg?: string;
  sort?: number;
}) {
  const { error } = await supabase.from("category").insert(input);
  if (error) throw error;
}

export async function updateCategory(
  id: string,
  input: Partial<{ label: string; dot: string; tile: string; pill_bg: string; pill_fg: string; sort: number }>,
) {
  const { error } = await supabase.from("category").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id: string) {
  const { error } = await supabase.from("category").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
