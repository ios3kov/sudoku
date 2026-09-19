use std::collections::HashMap;
use std::sync::RwLock;

use openmls::prelude::OpenMlsProvider;
use openmls_rust_crypto::{MemoryStorage, RustCrypto};
use wasm_bindgen::prelude::*;

const PROTOCOL: &str = "mls-rfc9420";
const OPENMLS_VERSION: &str = "0.9.0";

const STATE_MAGIC: &[u8; 8] = b"SMLSST01";
const MAX_STATE_BYTES: usize = 16 * 1024 * 1024;
const MAX_STATE_ENTRIES: usize = 100_000;

#[wasm_bindgen]
pub struct Provider {
    crypto: RustCrypto,
    storage: MemoryStorage,
}

impl Default for Provider {
    fn default() -> Self {
        Self {
            crypto: RustCrypto::default(),
            storage: MemoryStorage::default(),
        }
    }
}

impl OpenMlsProvider for Provider {
    type CryptoProvider = RustCrypto;
    type RandProvider = RustCrypto;
    type StorageProvider = MemoryStorage;

    fn storage(&self) -> &Self::StorageProvider {
        &self.storage
    }

    fn crypto(&self) -> &Self::CryptoProvider {
        &self.crypto
    }

    fn rand(&self) -> &Self::RandProvider {
        &self.crypto
    }
}

#[wasm_bindgen]
impl Provider {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Provider {
        Provider::default()
    }

    #[wasm_bindgen(js_name = exportState)]
    pub fn export_state(&self) -> Result<Vec<u8>, JsError> {
        encode_storage(&self.storage).map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = fromState)]
    pub fn from_state(bytes: &[u8]) -> Result<Provider, JsError> {
        let storage = decode_storage(bytes).map_err(|message| JsError::new(&message))?;
        Ok(Provider {
            crypto: RustCrypto::default(),
            storage,
        })
    }
}

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
    r#"{"protocol":"mls-rfc9420","openmls":"0.9.0","state_blob_version":1,"persistent_state":true,"ui_ready":false}"#.to_owned()
}

fn encode_storage(storage: &MemoryStorage) -> Result<Vec<u8>, String> {
    let values = storage
        .values
        .read()
        .map_err(|_| "MLS storage lock is poisoned".to_owned())?;

    if values.len() > MAX_STATE_ENTRIES {
        return Err("MLS state contains too many entries".to_owned());
    }

    let mut total = STATE_MAGIC.len() + 4;
    for (key, value) in values.iter() {
        if key.len() > u32::MAX as usize || value.len() > u32::MAX as usize {
            return Err("MLS state entry is too large".to_owned());
        }
        total = total
            .checked_add(8)
            .and_then(|n| n.checked_add(key.len()))
            .and_then(|n| n.checked_add(value.len()))
            .ok_or_else(|| "MLS state size overflow".to_owned())?;
        if total > MAX_STATE_BYTES {
            return Err("MLS state exceeds size limit".to_owned());
        }
    }

    let mut entries: Vec<(Vec<u8>, Vec<u8>)> = values
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    drop(values);

    entries.sort_by(|left, right| left.0.cmp(&right.0));

    let mut output = Vec::with_capacity(total);
    output.extend_from_slice(STATE_MAGIC);
    output.extend_from_slice(
        &u32::try_from(entries.len())
            .map_err(|_| "MLS state entry count overflow".to_owned())?
            .to_be_bytes(),
    );

    for (key, value) in entries {
        output.extend_from_slice(
            &u32::try_from(key.len())
                .map_err(|_| "MLS state key length overflow".to_owned())?
                .to_be_bytes(),
        );
        output.extend_from_slice(
            &u32::try_from(value.len())
                .map_err(|_| "MLS state value length overflow".to_owned())?
                .to_be_bytes(),
        );
        output.extend_from_slice(&key);
        output.extend_from_slice(&value);
    }

    Ok(output)
}

fn decode_storage(bytes: &[u8]) -> Result<MemoryStorage, String> {
    if bytes.len() > MAX_STATE_BYTES {
        return Err("MLS state exceeds size limit".to_owned());
    }

    let mut reader = StateReader::new(bytes);
    let magic = reader.read_exact(STATE_MAGIC.len())?;
    if magic != STATE_MAGIC {
        return Err("MLS state has invalid magic/version".to_owned());
    }

    let entry_count = reader.read_u32()? as usize;
    if entry_count > MAX_STATE_ENTRIES {
        return Err("MLS state contains too many entries".to_owned());
    }

    let mut values = HashMap::with_capacity(entry_count);
    for _ in 0..entry_count {
        let key_len = reader.read_u32()? as usize;
        let value_len = reader.read_u32()? as usize;

        let key = reader.read_exact(key_len)?.to_vec();
        let value = reader.read_exact(value_len)?.to_vec();

        if values.insert(key, value).is_some() {
            return Err("MLS state contains duplicate keys".to_owned());
        }
    }

    if !reader.is_finished() {
        return Err("MLS state contains trailing bytes".to_owned());
    }

    Ok(MemoryStorage {
        values: RwLock::new(values),
    })
}

struct StateReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> StateReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, position: 0 }
    }

    fn read_exact(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .position
            .checked_add(length)
            .ok_or_else(|| "MLS state length overflow".to_owned())?;
        if end > self.bytes.len() {
            return Err("MLS state is truncated".to_owned());
        }
        let output = &self.bytes[self.position..end];
        self.position = end;
        Ok(output)
    }

    fn read_u32(&mut self) -> Result<u32, String> {
        let bytes = self.read_exact(4)?;
        let array: [u8; 4] = bytes
            .try_into()
            .map_err(|_| "MLS state integer decode failed".to_owned())?;
        Ok(u32::from_be_bytes(array))
    }

    fn is_finished(&self) -> bool {
        self.position == self.bytes.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_round_trip_is_deterministic() {
        let provider = Provider::default();
        {
            let mut values = provider.storage.values.write().expect("test storage lock");
            values.insert(b"b-key".to_vec(), b"second".to_vec());
            values.insert(b"a-key".to_vec(), b"first".to_vec());
        }

        let encoded = encode_storage(&provider.storage).expect("encode state");
        let encoded_again = encode_storage(&provider.storage).expect("encode state twice");
        assert_eq!(encoded, encoded_again);

        let restored = decode_storage(&encoded).expect("decode state");
        let restored_values = restored.values.read().expect("restored storage lock");
        assert_eq!(restored_values.get(b"a-key".as_slice()), Some(&b"first".to_vec()));
        assert_eq!(restored_values.get(b"b-key".as_slice()), Some(&b"second".to_vec()));
    }

    #[test]
    fn corrupted_state_is_rejected() {
        assert!(decode_storage(b"not-an-mls-state").is_err());

        let provider = Provider::default();
        let mut encoded = encode_storage(&provider.storage).expect("encode empty state");
        encoded.push(0);
        assert!(decode_storage(&encoded).is_err());
    }
}
