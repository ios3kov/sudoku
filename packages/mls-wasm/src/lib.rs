use std::collections::HashMap;
use std::sync::RwLock;

use openmls::prelude::{
    BasicCredential, Ciphersuite, CredentialWithKey, Deserialize, KeyPackage, KeyPackageIn,
    OpenMlsProvider, ProtocolVersion, Serialize, SignatureScheme,
};
use openmls_basic_credential::SignatureKeyPair;
use openmls_rust_crypto::{MemoryStorage, RustCrypto};
use wasm_bindgen::prelude::*;

const PROTOCOL: &str = "mls-rfc9420";
const OPENMLS_VERSION: &str = "0.9.0";
const CIPHERSUITE: Ciphersuite =
    Ciphersuite::MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519;
const MAX_CREDENTIAL_BYTES: usize = 256;
const ED25519_PUBLIC_KEY_BYTES: usize = 32;
const MAX_KEY_PACKAGE_BYTES: usize = 64 * 1024;

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
pub struct DeviceIdentity {
    credential: Vec<u8>,
    public_key: Vec<u8>,
}

#[wasm_bindgen]
impl DeviceIdentity {
    #[wasm_bindgen(js_name = fromPublic)]
    pub fn from_public(credential: &[u8], public_key: &[u8]) -> Result<DeviceIdentity, JsError> {
        validate_credential(credential).map_err(|message| JsError::new(&message))?;
        if public_key.len() != ED25519_PUBLIC_KEY_BYTES {
            return Err(JsError::new("MLS identity public key must be 32-byte Ed25519"));
        }
        Ok(DeviceIdentity {
            credential: credential.to_vec(),
            public_key: public_key.to_vec(),
        })
    }

    #[wasm_bindgen(js_name = credentialBytes)]
    pub fn credential_bytes(&self) -> Vec<u8> {
        self.credential.clone()
    }

    #[wasm_bindgen(js_name = publicKeyBytes)]
    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.public_key.clone()
    }
}

#[wasm_bindgen]
impl Provider {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Provider {
        Provider::default()
    }

    #[wasm_bindgen(js_name = createDeviceIdentity)]
    pub fn create_device_identity(&self, credential: &[u8]) -> Result<DeviceIdentity, JsError> {
        validate_credential(credential).map_err(|message| JsError::new(&message))?;

        let signer = SignatureKeyPair::new(SignatureScheme::ED25519)
            .map_err(|_| JsError::new("Failed to generate MLS signing key"))?;
        signer
            .store(self.storage())
            .map_err(|_| JsError::new("Failed to persist MLS signing key"))?;

        Ok(DeviceIdentity {
            credential: credential.to_vec(),
            public_key: signer.to_public_vec(),
        })
    }

    #[wasm_bindgen(js_name = createKeyPackage)]
    pub fn create_key_package(&self, identity: &DeviceIdentity) -> Result<Vec<u8>, JsError> {
        let signer = self.load_signer(identity)?;
        let credential = credential_with_key(identity);

        let bundle = KeyPackage::builder()
            .build(CIPHERSUITE, self, &signer, credential)
            .map_err(|_| JsError::new("Failed to build MLS KeyPackage"))?;

        bundle
            .key_package()
            .tls_serialize_detached()
            .map_err(|_| JsError::new("Failed to serialize MLS KeyPackage"))
    }

    #[wasm_bindgen(js_name = validateKeyPackage)]
    pub fn validate_key_package(&self, bytes: &[u8]) -> Result<Vec<u8>, JsError> {
        if bytes.is_empty() || bytes.len() > MAX_KEY_PACKAGE_BYTES {
            return Err(JsError::new("Invalid MLS KeyPackage size"));
        }

        let mut input = bytes;
        let key_package_in = KeyPackageIn::tls_deserialize(&mut input)
            .map_err(|_| JsError::new("Malformed MLS KeyPackage"))?;
        if !input.is_empty() {
            return Err(JsError::new("MLS KeyPackage contains trailing bytes"));
        }

        let key_package = key_package_in
            .validate(self.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| JsError::new("Invalid MLS KeyPackage"))?;

        if key_package.ciphersuite() != CIPHERSUITE {
            return Err(JsError::new("Unsupported MLS KeyPackage ciphersuite"));
        }

        key_package
            .tls_serialize_detached()
            .map_err(|_| JsError::new("Failed to serialize validated MLS KeyPackage"))
    }

    #[wasm_bindgen(js_name = exportState)]
    pub fn export_state(&self) -> Result<Vec<u8>, JsError> {
        encode_storage(&self.storage).map_err(|message| JsError::new(&message))
    }

    fn load_signer(&self, identity: &DeviceIdentity) -> Result<SignatureKeyPair, JsError> {
        SignatureKeyPair::read(
            self.storage(),
            &identity.public_key,
            SignatureScheme::ED25519,
        )
        .ok_or_else(|| JsError::new("MLS signing key is missing from provider state"))
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
    r#"{"protocol":"mls-rfc9420","openmls":"0.9.0","state_blob_version":1,"persistent_state":true,"device_identity":true,"key_packages":true,"ui_ready":false}"#.to_owned()
}

fn validate_credential(credential: &[u8]) -> Result<(), String> {
    if credential.is_empty() {
        return Err("MLS credential must not be empty".to_owned());
    }
    if credential.len() > MAX_CREDENTIAL_BYTES {
        return Err("MLS credential exceeds size limit".to_owned());
    }
    Ok(())
}

fn credential_with_key(identity: &DeviceIdentity) -> CredentialWithKey {
    CredentialWithKey {
        credential: BasicCredential::new(identity.credential.clone()).into(),
        signature_key: identity.public_key.clone().into(),
    }
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
    fn identity_and_key_packages_survive_state_restore() {
        let provider = Provider::default();
        let identity = provider
            .create_device_identity(b"user-1:device-1")
            .expect("create identity");

        let first = provider
            .create_key_package(&identity)
            .expect("create first key package");
        assert!(!first.is_empty());

        let state = encode_storage(&provider.storage).expect("encode provider state");
        let restored = Provider {
            crypto: RustCrypto::default(),
            storage: decode_storage(&state).expect("restore provider state"),
        };

        let restored_identity = DeviceIdentity::from_public(
            &identity.credential,
            &identity.public_key,
        )
        .expect("restore public identity handle");

        let second = restored
            .create_key_package(&restored_identity)
            .expect("create key package after reload");
        assert!(!second.is_empty());
        assert_ne!(first, second);

        let validator = Provider::default();
        assert_eq!(
            validator
                .validate_key_package(&first)
                .expect("validate first package"),
            first
        );
        assert!(validator.validate_key_package(b"invalid").is_err());
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
