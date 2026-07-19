import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaleDraftProvider, useSaleDraft } from "./SaleDraftContext";

function Adder() {
  const { setCart, setCustomerId } = useSaleDraft();
  return (
    <button onClick={() => { setCart([{ id: "p1", qty: 2 }]); setCustomerId("c1"); }}>
      add
    </button>
  );
}
function Viewer() {
  const { cart, customerId } = useSaleDraft();
  return <div>qty:{cart.reduce((s, c) => s + c.qty, 0)} cust:{customerId ?? "none"}</div>;
}

describe("SaleDraftContext", () => {
  it("comparte el carrito y el cliente entre consumidores del mismo provider", () => {
    render(
      <SaleDraftProvider>
        <Adder />
        <Viewer />
      </SaleDraftProvider>,
    );
    expect(screen.getByText("qty:0 cust:none")).toBeTruthy();
    fireEvent.click(screen.getByText("add"));
    expect(screen.getByText("qty:2 cust:c1")).toBeTruthy();
  });

  it("useSaleDraft fuera del provider lanza error", () => {
    function Bare() { useSaleDraft(); return null; }
    expect(() => render(<Bare />)).toThrow(/SaleDraftProvider/);
  });
});
