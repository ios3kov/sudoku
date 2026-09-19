use wasm_bindgen::prelude::*;

const PROTOCOL: &str = "mls-rfc9420";
const OPENMLS_VERSION: &str = "0.9.0";

#[wasm_bindgen]
pub fn protocol_name() -> String {
    PROTOCOL.to_owned()
}

#[wasm_bindgen]
pub fn openmls_version() -> String {
    OPENMLS_VERSION.to_owned()
}

#[wasm_bindgen]
pub fn binding_capabilities() -> String {
    // Deliberately minimal until state persistence and fallible MLS operations
    // are implemented and covered by browser interoperability tests.
    r#"{"protocol":"mls-rfc9420","openmls":"0.9.0","persistent_state":false,"ui_ready":false}"#.to_owned()
}
