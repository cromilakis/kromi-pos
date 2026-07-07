import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthProvider";
import { WorkProvider } from "@/session/WorkContext";
import { Toaster } from "@/components/ui/sonner";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WorkProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster />
        </WorkProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
