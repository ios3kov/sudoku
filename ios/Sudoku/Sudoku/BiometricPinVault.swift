import Foundation
import LocalAuthentication
import Security

enum BiometricPinVaultError: LocalizedError {
    case unavailable
    case invalidPin
    case keychain(OSStatus)
    case missingPin
    case invalidStoredPin

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Biometric authentication is unavailable"
        case .invalidPin:
            return "PIN must contain exactly four digits"
        case .keychain:
            return "Unable to access biometric quick unlock"
        case .missingPin:
            return "Biometric quick unlock is not configured"
        case .invalidStoredPin:
            return "Stored biometric quick unlock is invalid"
        }
    }
}

final class BiometricPinVault {
    struct Status {
        let available: Bool
        let enrolled: Bool
        let type: String
    }

    private let service = "moscow.sudoku.app.device-pin"
    private let account = "quick-unlock"

    func status() -> Status {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        )

        let type: String
        switch context.biometryType {
        case .faceID:
            type = "faceID"
        case .touchID:
            type = "touchID"
        case .opticID:
            type = "opticID"
        case .none:
            type = "none"
        @unknown default:
            type = "unknown"
        }

        return Status(
            available: available,
            enrolled: hasStoredPin(),
            type: type
        )
    }

    func store(pin: String) throws {
        guard pin.range(of: #"^[0-9]{4}$"#, options: .regularExpression) != nil else {
            throw BiometricPinVaultError.invalidPin
        }

        clear()

        var accessError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .biometryCurrentSet,
            &accessError
        ) else {
            throw BiometricPinVaultError.unavailable
        }

        let item: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessControl as String: accessControl,
            kSecValueData as String: Data(pin.utf8),
        ]

        let result = SecItemAdd(item as CFDictionary, nil)
        guard result == errSecSuccess else {
            throw BiometricPinVaultError.keychain(result)
        }
    }

    func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    func unlock(
        reason: String,
        completion: @escaping (Result<String, Error>) -> Void
    ) {
        let context = LAContext()
        context.localizedCancelTitle = "Use PIN"

        var error: NSError?
        guard context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        ) else {
            completion(.failure(BiometricPinVaultError.unavailable))
            return
        }

        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        ) { [weak self] success, evaluationError in
            guard let self else { return }

            guard success else {
                completion(.failure(evaluationError ?? BiometricPinVaultError.unavailable))
                return
            }

            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: self.service,
                kSecAttrAccount as String: self.account,
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecReturnData as String: true,
                kSecUseAuthenticationContext as String: context,
            ]

            var item: CFTypeRef?
            let result = SecItemCopyMatching(query as CFDictionary, &item)
            guard result == errSecSuccess else {
                if result == errSecItemNotFound {
                    completion(.failure(BiometricPinVaultError.missingPin))
                } else {
                    completion(.failure(BiometricPinVaultError.keychain(result)))
                }
                return
            }

            guard
                let data = item as? Data,
                let pin = String(data: data, encoding: .utf8),
                pin.range(of: #"^[0-9]{4}$"#, options: .regularExpression) != nil
            else {
                self.clear()
                completion(.failure(BiometricPinVaultError.invalidStoredPin))
                return
            }

            completion(.success(pin))
        }
    }

    private func hasStoredPin() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecReturnAttributes as String: true,
            kSecUseAuthenticationUI as String: kSecUseAuthenticationUIFail,
        ]

        let result = SecItemCopyMatching(query as CFDictionary, nil)
        return result == errSecSuccess || result == errSecInteractionNotAllowed
    }
}
