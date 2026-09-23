import Foundation
import LocalAuthentication
import Security

enum BiometricKeyStoreError: Error {
    case unavailable
    case canceled
    case noKey
    case keyCreationFailed
    case signingFailed
}

final class BiometricKeyStore {
    static let shared = BiometricKeyStore()

    private let applicationTag = Data("moscow.sudoku.biometric-key.v1".utf8)

    private init() {}

    func availability() -> [String: Any] {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        )

        let kind: String
        if available {
            switch context.biometryType {
            case .faceID:
                kind = "face"
            case .touchID:
                kind = "touch"
            default:
                kind = "biometric"
            }
        } else {
            kind = "none"
        }

        return [
            "available": available,
            "kind": kind,
        ]
    }

    func createCredential() throws -> String {
        let status = availability()
        guard status["available"] as? Bool == true else {
            throw BiometricKeyStoreError.unavailable
        }

        deleteCredential()

        var accessError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            &accessError
        ) else {
            throw BiometricKeyStoreError.keyCreationFailed
        }

        let privateAttributes: [String: Any] = [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: applicationTag,
            kSecAttrAccessControl as String: accessControl,
        ]

        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecPrivateKeyAttrs as String: privateAttributes,
        ]

        var createError: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(
            attributes as CFDictionary,
            &createError
        ),
        let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw BiometricKeyStoreError.keyCreationFailed
        }

        var exportError: Unmanaged<CFError>?
        guard let publicData = SecKeyCopyExternalRepresentation(
            publicKey,
            &exportError
        ) as Data? else {
            deleteCredential()
            throw BiometricKeyStoreError.keyCreationFailed
        }

        guard publicData.count == 65, publicData.first == 0x04 else {
            deleteCredential()
            throw BiometricKeyStoreError.keyCreationFailed
        }

        return publicData.base64EncodedString()
    }

    func deleteCredential() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: applicationTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        ]
        SecItemDelete(query as CFDictionary)
    }

    func sign(
        payload: String,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        let context = LAContext()
        context.localizedCancelTitle = "Use PIN"

        var policyError: NSError?
        guard context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &policyError
        ) else {
            completion(.failure(BiometricKeyStoreError.unavailable))
            return
        }

        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Unlock your private messages"
        ) { [weak self] success, error in
            guard let self else { return }

            guard success else {
                if let laError = error as? LAError,
                   [.userCancel, .appCancel, .systemCancel].contains(laError.code) {
                    completion(.failure(BiometricKeyStoreError.canceled))
                } else {
                    completion(.failure(BiometricKeyStoreError.unavailable))
                }
                return
            }

            let query: [String: Any] = [
                kSecClass as String: kSecClassKey,
                kSecAttrApplicationTag as String: self.applicationTag,
                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
                kSecReturnRef as String: true,
                kSecUseAuthenticationContext as String: context,
            ]

            var item: CFTypeRef?
            let copyStatus = SecItemCopyMatching(
                query as CFDictionary,
                &item
            )
            guard copyStatus == errSecSuccess, let item else {
                completion(.failure(BiometricKeyStoreError.noKey))
                return
            }
            let privateKey = item as! SecKey

            let algorithm = SecKeyAlgorithm.ecdsaSignatureMessageX962SHA256
            guard SecKeyIsAlgorithmSupported(privateKey, .sign, algorithm) else {
                completion(.failure(BiometricKeyStoreError.signingFailed))
                return
            }

            var signError: Unmanaged<CFError>?
            guard let signature = SecKeyCreateSignature(
                privateKey,
                algorithm,
                Data(payload.utf8) as CFData,
                &signError
            ) as Data? else {
                completion(.failure(BiometricKeyStoreError.signingFailed))
                return
            }

            completion(.success(signature.base64EncodedString()))
        }
    }
}
