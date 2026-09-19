import { assertBrowserCryptoCapabilities } from "./capabilities";

export interface MlsWasmCapabilities {
  protocol: "mls-rfc9420";
  openmls: "0.9.0";
  state_blob_version: number;
  persistent_state: boolean;
  device_identity: boolean;
  key_packages: boolean;
  two_party_groups: boolean;
  application_messages: boolean;
  membership_rekey: boolean;
  key_package_identity_binding: boolean;
  group_member_identity_binding: boolean;
  ui_ready: boolean;
}

type MlsWasmModule = typeof import("../../../generated/mls-wasm/sudoku_mls_wasm");

let modulePromise: Promise<MlsWasmModule> | null = null;

function validateCapabilities(raw: string): MlsWasmCapabilities {
  const value = JSON.parse(raw) as Partial<MlsWasmCapabilities>;
  if (
    value.protocol !== "mls-rfc9420"
    || value.openmls !== "0.9.0"
    || value.state_blob_version !== 1
    || value.persistent_state !== true
    || value.device_identity !== true
    || value.key_packages !== true
    || value.two_party_groups !== true
    || value.application_messages !== true
    || value.membership_rekey !== true
    || value.key_package_identity_binding !== true
    || value.group_member_identity_binding !== true
  ) {
    throw new Error("OpenMLS WASM capabilities do not match the required production contract");
  }
  return value as MlsWasmCapabilities;
}

export async function loadOpenMlsWasm(): Promise<MlsWasmModule> {
  if (typeof window === "undefined") {
    throw new Error("OpenMLS WASM is browser-only");
  }
  assertBrowserCryptoCapabilities();

  if (!modulePromise) {
    modulePromise = import("../../../generated/mls-wasm/sudoku_mls_wasm").then(async (module) => {
      await module.default();
      validateCapabilities(module.binding_capabilities());
      return module;
    });
  }
  return modulePromise;
}
