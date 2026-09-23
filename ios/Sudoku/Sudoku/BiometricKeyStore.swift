import Foundation
import LocalAuthentication
import Security

enum BiometricKeyStoreError: Error {
    case cancelled
    case unavailable
    case invalidated
    case failed
}

final class BiometricKeyStore {
    static let shared = BiometricKeyStore()

    private let applicationTag = Data("moscow.sudoku.biometric-unlock.v1".utf8)
    private let worker = DispatchQueue(label: "moscow.sudoku.biometric-key", qos: .userInitiated)

    private init() {}

    func availability() -> [String: Any] {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)

        let kind: String
        let label: String
        switch context.biometryType {
        case .faceID:
            kind = "faceID"
            label = "Face ID"
        case .touchID:
            kind = "touchID"
            label = "Touch ID"
        case .none:
            kind = "none"
            label = "Biometrics"
        @unknown default:
            kind = "biometric"
            label = "Biometrics"
        }

        return [
            "available": available,
            "kind": available ? kind : "none",
            "label": label,
        ]
    }

    func enroll(completion: @escaping (Result<String, BiometricKeyStoreError>) -> Void) {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"

        var evaluateError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &evaluateError) else {
            finish(.failure(.unavailable), completion)
            return
        }

        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: "Enable biometric unlock for Sudoku"
        ) { [weak self] success, error in
            guard let self else { return }
            guard success else {
                self.finish(.failure(self.mapLocalAuthenticationError(error)), completion)
                return
            }

            self.worker.async {
                self.deleteKeySilently()

                var accessError: Unmanaged<CFError>?
                guard let accessControl = SecAccessControlCreateWithFlags(
                    nil,
                    kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                    [.privateKeyUsage, .biometryCurrentSet],
                    &accessError
                ) else {
                    self.finish(.failure(.unavailable), completion)
                    return
                }

                let attributes: [String: Any] = [
                    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                    kSecAttrKeySizeInBits as String: 256,
                    kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
                    kSecPrivateKeyAttrs as String: [
                        kSecAttrIsPermanent as String: true,
                        kSecAttrApplicationTag as String: self.applicationTag,
                        kSecAttrAccessControl as String: accessControl,
                    ],
                ]

                var keyError: Unmanaged<CFError>?
                guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &keyError),
                      let publicKey = SecKeyCopyPublicKey(privateKey) else {
                    self.finish(.failure(.unavailable), completion)
                    return
                }

                var exportError: Unmanaged<CFError>?
                guard let exported = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data?,
                      exported.count == 65,
                      exported.first == 0x04 else {
                    self.deleteKeySilently()
                    self.finish(.failure(.failed), completion)
                    return
                }

                self.finish(.success(exported.base64EncodedString()), completion)
            }
        }
    }

    func sign(payload: String, completion: @escaping (Result<String, BiometricKeyStoreError>) -> Void) {
        guard payload.hasPrefix("sudoku-biometric-unlock:v1:"), payload.utf8.count <= 256 else {
            finish(.failure(.failed), completion)
            return
        }

        worker.async {
            let context = LAContext()
            context.localizedCancelTitle = "Use PIN"

            let query: [String: Any] = [
                kSecClass as String: kSecClassKey,
                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrApplicationTag as String: self.applicationTag,
                kSecReturnRef as String: true,
                kSecUseAuthenticationContext as String: context,
                kSecUseOperationPrompt as String: "Unlock Sudoku",
            ]

            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            guard status == errSecSuccess, let item else {
                self.finish(.failure(self.mapSecurityStatus(status)), completion)
                return
            }

            let privateKey = item as! SecKey
            var signatureError: Unmanaged<CFError>?
            guard let signature = SecKeyCreateSignature(
                privateKey,
                .ecdsaSignatureMessageX962SHA256,
                Data(payload.utf8) as CFData,
                &signatureError
            ) as Data? else {
                let mapped = self.mapCFError(signatureError?.takeRetainedValue())
                self.finish(.failure(mapped), completion)
                return
            }

            self.finish(.success(signature.base64EncodedString()), completion)
        }
    }

    func clear(completion: (() -> Void)? = nil) {
        worker.async {
            self.deleteKeySilently()
            if let completion {
                DispatchQueue.main.async(execute: completion)
            }
        }
    }

    private func deleteKeySilently() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrApplicationTag as String: applicationTag,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func mapSecurityStatus(_ status: OSStatus) -> BiometricKeyStoreError {
        switch status {
        case errSecUserCanceled:
            return .cancelled
        case errSecItemNotFound:
            return .invalidated
        case errSecAuthFailed, errSecInteractionNotAllowed:
            return .unavailable
        default:
            return .failed
        }
    }

    private func mapLocalAuthenticationError(_ error: Error?) -> BiometricKeyStoreError {
        guard let error = error as? LAError else { return .failed }
        switch error.code {
        case .userCancel, .systemCancel, .appCancel:
            return .cancelled
        case .biometryNotAvailable, .biometryNotEnrolled, .biometryLockout, .passcodeNotSet:
            return .unavailable
        default:
            return .failed
        }
    }

    private func mapCFError(_ error: CFError?) -> BiometricKeyStoreError {
        guard let error else { return .failed }
        let nsError = error as Error as NSError
        if nsError.domain == LAError.errorDomain {
            return mapLocalAuthenticationError(nsError)
        }
        return .failed
    }

    private func finish<T>(
        _ result: Result<T, BiometricKeyStoreError>,
        _ completion: @escaping (Result<T, BiometricKeyStoreError>) -> Void
    ) {
        DispatchQueue.main.async {
            completion(result)
        }
    }
}
