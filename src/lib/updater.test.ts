import { describe, it, expect } from "vitest";
import { checkForUpdate } from "./updater";

describe("checkForUpdate", () => {
  it("fuera de Tauri retorna null (no lanza)", async () => {
    // En jsdom, window existe pero sin __TAURI_INTERNALS__.
    await expect(checkForUpdate()).resolves.toBeNull();
  });
});
