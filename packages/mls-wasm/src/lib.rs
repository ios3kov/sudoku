use std::collections::HashMap;
use std::sync::RwLock;

use openmls::prelude::{
    BasicCredential, Ciphersuite, Credential, CredentialWithKey, GroupId, KeyPackage, KeyPackageIn,
    MlsGroup, MlsGroupJoinConfig, MlsMessageBodyIn, MlsMessageIn, OpenMlsProvider,
    ProcessedMessageContent, ProtocolVersion, SignatureScheme, StagedWelcome,
};
use openmls::prelude::tls_codec::{
    Deserialize as TlsDeserializeTrait, Serialize as TlsSerializeTrait,
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
const MAX_GROUP_ID_BYTES: usize = 128;
const MAX_MLS_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_APPLICATION_BYTES: usize = 256 * 1024;

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
pub struct AddMemberResult {
    commit: Vec<u8>,
    welcome: Vec<u8>,
}

#[wasm_bindgen]
impl AddMemberResult {
    #[wasm_bindgen(js_name = commitBytes)]
    pub fn commit_bytes(&self) -> Vec<u8> {
        self.commit.clone()
    }

    #[wasm_bindgen(js_name = welcomeBytes)]
    pub fn welcome_bytes(&self) -> Vec<u8> {
        self.welcome.clone()
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
        self.validate_key_package_inner(bytes)
            .map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = validateKeyPackageIdentity)]
    pub fn validate_key_package_identity(
        &self,
        bytes: &[u8],
        expected_credential: &[u8],
        expected_public_key: &[u8],
    ) -> Result<(), JsError> {
        self.validate_key_package_identity_inner(
            bytes,
            expected_credential,
            expected_public_key,
        )
        .map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = createGroup)]
    pub fn create_group(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
    ) -> Result<(), JsError> {
        self.create_group_inner(identity, group_id)
            .map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = addMember)]
    pub fn add_member(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
        key_package: &[u8],
    ) -> Result<AddMemberResult, JsError> {
        self.add_member_inner(identity, group_id, key_package)
            .map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = joinGroup)]
    pub fn join_group(&self, welcome: &[u8]) -> Result<Vec<u8>, JsError> {
        self.join_group_inner(welcome)
            .map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = encryptApplication)]
    pub fn encrypt_application(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
        plaintext: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        self.encrypt_application_inner(identity, group_id, plaintext)
            .map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = decryptApplication)]
    pub fn decrypt_application(
        &self,
        group_id: &[u8],
        message: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        self.decrypt_application_inner(group_id, message)
            .map_err(|message| JsError::new(&message))
    }

    #[wasm_bindgen(js_name = processHandshake)]
    pub fn process_handshake(
        &self,
        group_id: &[u8],
        message: &[u8],
    ) -> Result<(), JsError> {
        self.process_handshake_inner(group_id, message)
            .map_err(|error| JsError::new(&error))
    }

    #[wasm_bindgen(js_name = removeMember)]
    pub fn remove_member(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
        member_credential: &[u8],
    ) -> Result<Vec<u8>, JsError> {
        self.remove_member_inner(identity, group_id, member_credential)
            .map_err(|error| JsError::new(&error))
    }

    #[wasm_bindgen(js_name = mergePendingCommit)]
    pub fn merge_pending_commit(&self, group_id: &[u8]) -> Result<(), JsError> {
        self.merge_pending_commit_inner(group_id)
            .map_err(|error| JsError::new(&error))
    }

    #[wasm_bindgen(js_name = exportState)]
    pub fn export_state(&self) -> Result<Vec<u8>, JsError> {
        encode_storage(&self.storage).map_err(|message| JsError::new(&message))
    }

    fn create_group_inner(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
    ) -> Result<(), String> {
        validate_group_id(group_id)?;
        let signer = self.load_signer_inner(identity)?;
        MlsGroup::builder()
            .ciphersuite(CIPHERSUITE)
            .use_ratchet_tree_extension(true)
            .with_group_id(GroupId::from_slice(group_id))
            .build(self, &signer, credential_with_key(identity))
            .map_err(|_| "Failed to create MLS group".to_owned())?;
        Ok(())
    }

    fn add_member_inner(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
        key_package: &[u8],
    ) -> Result<AddMemberResult, String> {
        validate_group_id(group_id)?;
        let signer = self.load_signer_inner(identity)?;
        let new_member = self.parse_key_package_inner(key_package)?;
        let mut group = self.load_group_inner(group_id)?;

        let (commit, welcome, _) = group
            .add_members(self, &signer, &[new_member])
            .map_err(|_| "Failed to add MLS member".to_owned())?;

        Ok(AddMemberResult {
            commit: serialize_mls_message(&commit)?,
            welcome: serialize_mls_message(&welcome)?,
        })
    }

    fn join_group_inner(&self, welcome: &[u8]) -> Result<Vec<u8>, String> {
        let message = parse_mls_message(welcome)?;
        let welcome = match message.extract() {
            MlsMessageBodyIn::Welcome(welcome) => welcome,
            _ => return Err("Expected an MLS Welcome message".to_owned()),
        };

        let config = MlsGroupJoinConfig::builder().build();
        let staged = StagedWelcome::new_from_welcome(self, &config, welcome, None)
            .map_err(|_| "Failed to stage MLS Welcome".to_owned())?;
        let group = staged
            .into_group(self)
            .map_err(|_| "Failed to join MLS group".to_owned())?;
        Ok(group.group_id().as_slice().to_vec())
    }

    fn encrypt_application_inner(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
        plaintext: &[u8],
    ) -> Result<Vec<u8>, String> {
        validate_group_id(group_id)?;
        if plaintext.is_empty() || plaintext.len() > MAX_APPLICATION_BYTES {
            return Err("Invalid MLS application payload size".to_owned());
        }
        let signer = self.load_signer_inner(identity)?;
        let mut group = self.load_group_inner(group_id)?;
        let message = group
            .create_message(self, &signer, plaintext)
            .map_err(|_| "Failed to encrypt MLS application message".to_owned())?;
        serialize_mls_message(&message)
    }

    fn decrypt_application_inner(
        &self,
        group_id: &[u8],
        message: &[u8],
    ) -> Result<Vec<u8>, String> {
        validate_group_id(group_id)?;
        let message = parse_mls_message(message)?
            .try_into_protocol_message()
            .map_err(|_| "Expected an MLS protocol message".to_owned())?;
        let mut group = self.load_group_inner(group_id)?;
        let processed = group
            .process_message(self, message)
            .map_err(|_| "Failed to process MLS application message".to_owned())?;

        match processed.into_content() {
            ProcessedMessageContent::ApplicationMessage(application) => {
                Ok(application.into_bytes())
            }
            _ => Err("Expected an MLS application message".to_owned()),
        }
    }

    fn load_group_inner(&self, group_id: &[u8]) -> Result<MlsGroup, String> {
        MlsGroup::load(self.storage(), &GroupId::from_slice(group_id))
            .map_err(|_| "Failed to load MLS group state".to_owned())?
            .ok_or_else(|| "MLS group state not found".to_owned())
    }

    fn process_handshake_inner(
        &self,
        group_id: &[u8],
        message: &[u8],
    ) -> Result<(), String> {
        validate_group_id(group_id)?;
        let protocol_message = parse_mls_message(message)?
            .try_into_protocol_message()
            .map_err(|_| "Expected an MLS handshake protocol message".to_owned())?;
        let mut group = self.load_group_inner(group_id)?;
        let processed = group
            .process_message(self, protocol_message)
            .map_err(|_| "Failed to process MLS handshake message".to_owned())?;

        match processed.into_content() {
            ProcessedMessageContent::StagedCommitMessage(staged) => group
                .merge_staged_commit(self, *staged)
                .map_err(|_| "Failed to merge incoming MLS commit".to_owned()),
            ProcessedMessageContent::OwnPendingCommit => group
                .merge_pending_commit(self)
                .map_err(|_| "Failed to merge own pending MLS commit".to_owned()),
            _ => Err("Expected an MLS Commit message".to_owned()),
        }
    }

    fn remove_member_inner(
        &self,
        identity: &DeviceIdentity,
        group_id: &[u8],
        member_credential: &[u8],
    ) -> Result<Vec<u8>, String> {
        validate_group_id(group_id)?;
        validate_credential(member_credential)?;
        let signer = self.load_signer_inner(identity)?;
        let mut group = self.load_group_inner(group_id)?;

        let credential: Credential = BasicCredential::new(member_credential.to_vec()).into();
        let leaf = group
            .member_leaf_index(&credential)
            .ok_or_else(|| "MLS member credential not found".to_owned())?;

        let (commit, _, _) = group
            .remove_members(self, &signer, &[leaf])
            .map_err(|_| "Failed to remove MLS member".to_owned())?;

        serialize_mls_message(&commit)
    }

    fn merge_pending_commit_inner(&self, group_id: &[u8]) -> Result<(), String> {
        validate_group_id(group_id)?;
        let mut group = self.load_group_inner(group_id)?;
        group
            .merge_pending_commit(self)
            .map_err(|_| "Failed to merge local MLS pending commit".to_owned())
    }

    fn parse_key_package_inner(&self, bytes: &[u8]) -> Result<KeyPackage, String> {
        if bytes.is_empty() || bytes.len() > MAX_KEY_PACKAGE_BYTES {
            return Err("Invalid MLS KeyPackage size".to_owned());
        }

        let mut input = bytes;
        let key_package_in = KeyPackageIn::tls_deserialize(&mut input)
            .map_err(|_| "Malformed MLS KeyPackage".to_owned())?;
        if !input.is_empty() {
            return Err("MLS KeyPackage contains trailing bytes".to_owned());
        }

        let key_package = key_package_in
            .validate(self.crypto(), ProtocolVersion::Mls10)
            .map_err(|_| "Invalid MLS KeyPackage".to_owned())?;

        if key_package.ciphersuite() != CIPHERSUITE {
            return Err("Unsupported MLS KeyPackage ciphersuite".to_owned());
        }
        Ok(key_package)
    }

    fn validate_key_package_inner(&self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        let key_package = self.parse_key_package_inner(bytes)?;

        key_package
            .tls_serialize_detached()
            .map_err(|_| "Failed to serialize validated MLS KeyPackage".to_owned())
    }

    fn validate_key_package_identity_inner(
        &self,
        bytes: &[u8],
        expected_credential: &[u8],
        expected_public_key: &[u8],
    ) -> Result<(), String> {
        validate_credential(expected_credential)?;
        if expected_public_key.len() != ED25519_PUBLIC_KEY_BYTES {
            return Err("Expected MLS identity key must be 32-byte Ed25519".to_owned());
        }

        let key_package = self.parse_key_package_inner(bytes)?;
        let leaf = key_package.leaf_node();
        let basic = BasicCredential::try_from(leaf.credential().clone())
            .map_err(|_| "MLS KeyPackage does not use a BasicCredential".to_owned())?;

        if basic.identity() != expected_credential {
            return Err("MLS KeyPackage credential does not match expected device".to_owned());
        }
        if leaf.signature_key().as_slice() != expected_public_key {
            return Err(
                "MLS KeyPackage signature key does not match pinned device identity".to_owned(),
            );
        }
        Ok(())
    }

    fn load_signer_inner(&self, identity: &DeviceIdentity) -> Result<SignatureKeyPair, String> {
        SignatureKeyPair::read(
            self.storage(),
            &identity.public_key,
            SignatureScheme::ED25519,
        )
        .ok_or_else(|| "MLS signing key is missing from provider state".to_owned())
    }

    fn load_signer(&self, identity: &DeviceIdentity) -> Result<SignatureKeyPair, JsError> {
        self.load_signer_inner(identity)
            .map_err(|message| JsError::new(&message))
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
    r#"{"protocol":"mls-rfc9420","openmls":"0.9.0","state_blob_version":1,"persistent_state":true,"device_identity":true,"key_packages":true,"two_party_groups":true,"application_messages":true,"membership_rekey":true,"two_phase_membership":true,"key_package_identity_binding":true,"ui_ready":false}"#.to_owned()
}

fn validate_group_id(group_id: &[u8]) -> Result<(), String> {
    if group_id.is_empty() || group_id.len() > MAX_GROUP_ID_BYTES {
        return Err("Invalid MLS group id size".to_owned());
    }
    Ok(())
}

fn serialize_mls_message(
    message: &openmls::prelude::MlsMessageOut,
) -> Result<Vec<u8>, String> {
    message
        .tls_serialize_detached()
        .map_err(|_| "Failed to serialize MLS message".to_owned())
}

fn parse_mls_message(bytes: &[u8]) -> Result<MlsMessageIn, String> {
    if bytes.is_empty() || bytes.len() > MAX_MLS_MESSAGE_BYTES {
        return Err("Invalid MLS message size".to_owned());
    }
    let mut input = bytes;
    let message = MlsMessageIn::tls_deserialize(&mut input)
        .map_err(|_| "Malformed MLS message".to_owned())?;
    if !input.is_empty() {
        return Err("MLS message contains trailing bytes".to_owned());
    }
    Ok(message)
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
                .validate_key_package_inner(&first)
                .expect("validate first package"),
            first
        );
        assert!(validator.validate_key_package_inner(b"invalid").is_err());
        assert!(
            validator
                .validate_key_package_identity_inner(
                    &first,
                    b"user-1:device-1",
                    &identity.public_key,
                )
                .is_ok()
        );
        assert!(
            validator
                .validate_key_package_identity_inner(
                    &first,
                    b"user-1:device-1",
                    &[0u8; 32],
                )
                .is_err()
        );
        assert!(
            validator
                .validate_key_package_identity_inner(
                    &first,
                    b"different-user:device",
                    &identity.public_key,
                )
                .is_err()
        );
    }

    #[test]
    fn two_member_group_survives_reload_and_exchanges_messages() {
        let alice = Provider::default();
        let bob = Provider::default();

        let alice_identity = alice
            .create_device_identity(b"alice:device-1")
            .expect("alice identity");
        let bob_identity = bob
            .create_device_identity(b"bob:device-1")
            .expect("bob identity");

        let bob_key_package = bob
            .create_key_package(&bob_identity)
            .expect("bob key package");

        let group_id = b"conversation-mls-1";
        alice
            .create_group_inner(&alice_identity, group_id)
            .expect("create alice group");
        let add = alice
            .add_member_inner(&alice_identity, group_id, &bob_key_package)
            .expect("prepare add bob");
        alice
            .merge_pending_commit_inner(group_id)
            .expect("merge add bob after durable acceptance");

        let joined_group_id = bob
            .join_group_inner(&add.welcome)
            .expect("bob joins from welcome");
        assert_eq!(joined_group_id, group_id);

        let alice_state = encode_storage(&alice.storage).expect("alice state");
        let bob_state = encode_storage(&bob.storage).expect("bob state");

        let alice_reloaded = Provider {
            crypto: RustCrypto::default(),
            storage: decode_storage(&alice_state).expect("restore alice"),
        };
        let bob_reloaded = Provider {
            crypto: RustCrypto::default(),
            storage: decode_storage(&bob_state).expect("restore bob"),
        };

        let alice_handle = DeviceIdentity {
            credential: alice_identity.credential.clone(),
            public_key: alice_identity.public_key.clone(),
        };
        let bob_handle = DeviceIdentity {
            credential: bob_identity.credential.clone(),
            public_key: bob_identity.public_key.clone(),
        };

        let encrypted = alice_reloaded
            .encrypt_application_inner(&alice_handle, group_id, b"hello bob")
            .expect("alice encrypts");
        let plaintext = bob_reloaded
            .decrypt_application_inner(group_id, &encrypted)
            .expect("bob decrypts");
        assert_eq!(plaintext, b"hello bob");

        let reply = bob_reloaded
            .encrypt_application_inner(&bob_handle, group_id, b"hello alice")
            .expect("bob encrypts");
        let reply_plaintext = alice_reloaded
            .decrypt_application_inner(group_id, &reply)
            .expect("alice decrypts");
        assert_eq!(reply_plaintext, b"hello alice");
    }

    #[test]
    fn removed_member_cannot_decrypt_next_epoch() {
        let alice = Provider::default();
        let bob = Provider::default();
        let charlie = Provider::default();

        let alice_identity = alice
            .create_device_identity(b"alice:device-1")
            .expect("alice identity");
        let bob_identity = bob
            .create_device_identity(b"bob:device-1")
            .expect("bob identity");
        let charlie_identity = charlie
            .create_device_identity(b"charlie:device-1")
            .expect("charlie identity");

        let bob_key_package = bob
            .create_key_package(&bob_identity)
            .expect("bob key package");
        let charlie_key_package = charlie
            .create_key_package(&charlie_identity)
            .expect("charlie key package");

        let group_id = b"conversation-mls-epoch-rotation";
        alice
            .create_group_inner(&alice_identity, group_id)
            .expect("create group");

        let add_bob = alice
            .add_member_inner(&alice_identity, group_id, &bob_key_package)
            .expect("prepare add bob");
        alice
            .merge_pending_commit_inner(group_id)
            .expect("merge add bob");
        bob.join_group_inner(&add_bob.welcome)
            .expect("bob joins");

        let add_charlie = alice
            .add_member_inner(&alice_identity, group_id, &charlie_key_package)
            .expect("prepare add charlie");
        alice
            .merge_pending_commit_inner(group_id)
            .expect("merge add charlie");
        bob.process_handshake_inner(group_id, &add_charlie.commit)
            .expect("bob applies charlie add commit");
        charlie
            .join_group_inner(&add_charlie.welcome)
            .expect("charlie joins");

        let before_remove = alice
            .encrypt_application_inner(&alice_identity, group_id, b"before remove")
            .expect("encrypt before remove");
        assert_eq!(
            bob.decrypt_application_inner(group_id, &before_remove)
                .expect("bob decrypts before removal"),
            b"before remove"
        );
        assert_eq!(
            charlie
                .decrypt_application_inner(group_id, &before_remove)
                .expect("charlie decrypts before removal"),
            b"before remove"
        );

        let remove_bob = alice
            .remove_member_inner(&alice_identity, group_id, &bob_identity.credential)
            .expect("prepare remove bob");
        alice
            .merge_pending_commit_inner(group_id)
            .expect("merge remove bob");

        charlie
            .process_handshake_inner(group_id, &remove_bob)
            .expect("charlie applies removal commit");
        bob.process_handshake_inner(group_id, &remove_bob)
            .expect("bob applies self-removal commit");

        let after_remove = alice
            .encrypt_application_inner(&alice_identity, group_id, b"after remove")
            .expect("encrypt after remove");
        assert_eq!(
            charlie
                .decrypt_application_inner(group_id, &after_remove)
                .expect("charlie decrypts after removal"),
            b"after remove"
        );
        assert!(
            bob.decrypt_application_inner(group_id, &after_remove)
                .is_err(),
            "removed member must not decrypt messages from the new MLS epoch"
        );
    }

    #[test]
    fn pending_membership_commit_survives_reload_before_merge() {
        let alice = Provider::default();
        let bob = Provider::default();

        let alice_identity = alice
            .create_device_identity(b"alice:pending-device")
            .expect("alice identity");
        let bob_identity = bob
            .create_device_identity(b"bob:pending-device")
            .expect("bob identity");
        let bob_key_package = bob
            .create_key_package(&bob_identity)
            .expect("bob key package");

        let group_id = b"conversation-pending-commit";
        alice
            .create_group_inner(&alice_identity, group_id)
            .expect("create group");
        let prepared = alice
            .add_member_inner(&alice_identity, group_id, &bob_key_package)
            .expect("prepare add bob");

        // The creator is intentionally still in PendingCommit state here.
        // OpenMLS permits application traffic in the current (old) epoch until merge;
        // the browser adapter serializes our delivery flow and prevents that race.

        let state = encode_storage(&alice.storage).expect("export pending state");
        let restored = Provider {
            crypto: RustCrypto::default(),
            storage: decode_storage(&state).expect("restore pending state"),
        };

        bob.join_group_inner(&prepared.welcome)
            .expect("bob joins from prepared welcome");

        restored
            .merge_pending_commit_inner(group_id)
            .expect("merge pending commit after reload");

        let alice_handle = DeviceIdentity {
            credential: alice_identity.credential.clone(),
            public_key: alice_identity.public_key.clone(),
        };
        let encrypted = restored
            .encrypt_application_inner(&alice_handle, group_id, b"after merge")
            .expect("encrypt after merge");
        assert_eq!(
            bob.decrypt_application_inner(group_id, &encrypted)
                .expect("bob decrypts after merge"),
            b"after merge"
        );
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
