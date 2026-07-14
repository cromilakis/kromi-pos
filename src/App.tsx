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
import { AdminScreen } from "@/modules/admin/AdminScreen";
import { NotasCreditoScreen } from "@/modules/notas-credito/NotasCreditoScreen";
import { NuevaNotaCredito } from "@/modules/notas-credito/NuevaNotaCredito";
import { HistorialScreen } from "@/modules/historial/HistorialScreen";

function AdminRoute() {
  const { profile } = useAuth();
  return (
    <RequireRole role={profile?.role} allow={["admin", "kromi"]}>
      <AdminScreen />
    </RequireRole>
  );
}

function NotasCreditoRoute() {
  const { profile } = useAuth();
  return (
    <RequireRole role={profile?.role} allow={["admin", "kromi"]}>
      <NotasCreditoScreen />
    </RequireRole>
  );
}

function NuevaNotaCreditoRoute() {
  const { profile } = useAuth();
  return (
    <RequireRole role={profile?.role} allow={["admin", "kromi"]}>
      <NuevaNotaCredito />
    </RequireRole>
  );
}

function HistorialRoute() {
  const { profile } = useAuth();
  return (
    <RequireRole role={profile?.role} allow={["admin", "kromi"]}>
      <HistorialScreen />
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
        <Route path="notas-credito" element={<NotasCreditoRoute />} />
        <Route path="notas-credito/nueva" element={<NuevaNotaCreditoRoute />} />
        <Route path="historial" element={<HistorialRoute />} />
      </Route>
    </Routes>
  );
}
