import Foundation
import Capacitor
import Contacts
import ContactsUI
import LocalAuthentication

@objc(SudokuNativePlugin)
public final class SudokuNativePlugin: CAPPlugin, CAPBridgedPlugin, CNContactPickerDelegate {
    public let identifier = "SudokuNativePlugin"
    public let jsName = "SudokuNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "selectContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "canAuthenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    private var contactCall: CAPPluginCall?

    @objc public func selectContacts(_ call: CAPPluginCall) {
        guard contactCall == nil else {
            call.reject("A contact picker is already open.", "CONTACT_PICKER_BUSY")
            return
        }

        contactCall = call

        DispatchQueue.main.async { [weak self] in
            guard let self, let presentingViewController = self.bridge?.viewController else {
                self?.finishContacts(with: [])
                return
            }

            let picker = CNContactPickerViewController()
            picker.delegate = self
            picker.displayedPropertyKeys = [CNContactPhoneNumbersKey]
            presentingViewController.present(picker, animated: true)
        }
    }

    public func contactPicker(
        _ picker: CNContactPickerViewController,
        didSelect contacts: [CNContact]
    ) {
        let selected: [[String: Any]] = contacts.compactMap { contact in
            let phoneNumbers = contact.phoneNumbers
                .map { $0.value.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }

            guard !phoneNumbers.isEmpty else {
                return nil
            }

            let fullName = CNContactFormatter.string(from: contact, style: .fullName)?
                .trimmingCharacters(in: .whitespacesAndNewlines)

            var result: [String: Any] = ["tel": phoneNumbers]
            if let fullName, !fullName.isEmpty {
                result["name"] = [fullName]
            }
            return result
        }

        finishContacts(with: selected)
    }

    public func contactPickerDidCancel(_ picker: CNContactPickerViewController) {
        finishContacts(with: [])
    }

    @objc public func canAuthenticate(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        )

        call.resolve([
            "available": available,
            "biometry": biometryName(context.biometryType)
        ])
    }

    @objc public func authenticate(_ call: CAPPluginCall) {
        let requestedReason = call.getString("reason")?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let reason = (requestedReason?.isEmpty == false)
            ? requestedReason!
            : "Unlock private messages"

        let context = LAContext()
        context.localizedFallbackTitle = ""

        var error: NSError?
        guard context.canEvaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            error: &error
        ) else {
            call.resolve(["authenticated": false])
            return
        }

        context.evaluatePolicy(
            .deviceOwnerAuthenticationWithBiometrics,
            localizedReason: reason
        ) { success, _ in
            call.resolve(["authenticated": success])
        }
    }

    private func finishContacts(with contacts: [[String: Any]]) {
        contactCall?.resolve(["contacts": contacts])
        contactCall = nil
    }

    private func biometryName(_ type: LABiometryType) -> String {
        switch type {
        case .faceID:
            return "faceId"
        case .touchID:
            return "touchId"
        default:
            return "none"
        }
    }
}
