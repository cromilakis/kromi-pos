import { createContext, useContext, useState, type ReactNode, type Dispatch, type SetStateAction } from "react";

/** Ítem del carrito de venta: referencia al producto por id + cantidad.
 *  El precio/nombre se derivan en vivo del catálogo, no se guardan aquí. */
export interface CartItem { id: string; qty: number }

interface SaleDraftCtx {
  cart: CartItem[]; setCart: Dispatch<SetStateAction<CartItem[]>>;
  customerId: string | null; setCustomerId: Dispatch<SetStateAction<string | null>>;
}
const Ctx = createContext<SaleDraftCtx | null>(null);

/** Mantiene la "venta en curso" (carrito + cliente) en memoria, por encima de
 *  las rutas, para que sobreviva la navegación entre menús. Se limpia al
 *  desmontarse (logout) o al reiniciar la app. */
export function SaleDraftProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  return <Ctx.Provider value={{ cart, setCart, customerId, setCustomerId }}>{children}</Ctx.Provider>;
}

export function useSaleDraft() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSaleDraft fuera de SaleDraftProvider");
  return c;
}
