import { Routes, Route } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { RequireAuth } from "@/shell/RequireAuth";
import { RequireRole } from "@/shell/RequireRole";
import { AppLayout } from "@/shell/AppLayout";
import { InicioScreen } from "@/modules/inicio/InicioScreen";
import { StockScreen } from "@/modules/stock/StockScreen";
import { VentaScreen } from "@/modules/venta/VentaScreen";
import { CotizacionesScreen } from "@/modules/cotizaciones/CotizacionesScreen";
import { ClientesScreen } from "@/modules/clientes/ClientesScreen";
import { BusinessSettings } from "@/modules/admin/BusinessSettings";

function AdminRoute() {
  const { profile } = useAuth();
  return (
    <RequireRole role={profile?.role} allow={["admin", "kromi"]}>
      <BusinessSettings />
    </RequireRole>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<InicioScreen />} />
        <Route path="venta" element={<VentaScreen />} />
        <Route path="cotizaciones" element={<CotizacionesScreen />} />
        <Route path="stock" element={<StockScreen />} />
        <Route path="clientes" element={<ClientesScreen />} />
        <Route path="admin" element={<AdminRoute />} />
      </Route>
    </Routes>
  );
}
