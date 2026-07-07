import { Routes, Route } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { RequireAuth } from "@/shell/RequireAuth";
import { RequireRole } from "@/shell/RequireRole";
import { AppLayout } from "@/shell/AppLayout";
import { Placeholder } from "@/routes/placeholders";
import { InicioScreen } from "@/modules/inicio/InicioScreen";
import { StockScreen } from "@/modules/stock/StockScreen";
import { VentaScreen } from "@/modules/venta/VentaScreen";
import { ClientesScreen } from "@/modules/clientes/ClientesScreen";

function AdminRoute() {
  const { profile } = useAuth();
  return (
    <RequireRole role={profile?.role} allow={["admin", "kromi"]}>
      <Placeholder title="Administración" />
    </RequireRole>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<InicioScreen />} />
        <Route path="venta" element={<VentaScreen />} />
        <Route path="stock" element={<StockScreen />} />
        <Route path="clientes" element={<ClientesScreen />} />
        <Route path="admin" element={<AdminRoute />} />
      </Route>
    </Routes>
  );
}
