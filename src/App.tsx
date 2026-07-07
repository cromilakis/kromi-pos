import { Routes, Route } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { RequireAuth } from "@/shell/RequireAuth";
import { RequireRole } from "@/shell/RequireRole";
import { AppLayout } from "@/shell/AppLayout";
import { Placeholder } from "@/routes/placeholders";
import { InicioScreen } from "@/modules/inicio/InicioScreen";

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
        <Route path="venta" element={<Placeholder title="Venta" />} />
        <Route path="stock" element={<Placeholder title="Stock" />} />
        <Route path="clientes" element={<Placeholder title="Clientes" />} />
        <Route path="cierre" element={<Placeholder title="Cierre" />} />
        <Route path="admin" element={<AdminRoute />} />
      </Route>
    </Routes>
  );
}
