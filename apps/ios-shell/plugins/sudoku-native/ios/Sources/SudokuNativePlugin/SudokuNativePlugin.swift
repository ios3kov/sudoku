import Foundation
import Capacitor
import Contacts
import ContactsUI
import LocalAuthentication
import UIKit

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
    private var privacyCover: UIView?

    override public func load() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(showPrivacyCover),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(hidePrivacyCover),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func showPrivacyCover() {
        DispatchQueue.main.async { [weak self] in
            guard
                let self,
                self.privacyCover == nil,
                let hostView = self.bridge?.viewController?.view
            else {
                return
            }

            let cover = UIView(frame: hostView.bounds)
            cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            cover.backgroundColor = UIColor(
                red: 247.0 / 255.0,
                green: 245.0 / 255.0,
                blue: 239.0 / 255.0,
                alpha: 1.0
            )
            cover.isUserInteractionEnabled = true
            cover.accessibilityIdentifier = "sudoku-native-privacy-cover"

            let title = UILabel()
            title.translatesAutoresizingMaskIntoConstraints = false
            title.text = "Sudoku"
            title.font = .systemFont(ofSize: 26, weight: .semibold)
            title.textColor = .label
            cover.addSubview(title)

            NSLayoutConstraint.activate([
                title.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
                title.centerYAnchor.constraint(equalTo: cover.centerYAnchor)
            ])

            hostView.addSubview(cover)
            self.privacyCover = cover
        }
    }

    @objc private func hidePrivacyCover() {
        DispatchQueue.main.async { [weak self] in
            self?.privacyCover?.removeFromSuperview()
            self?.privacyCover = nil
        }
    }

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
