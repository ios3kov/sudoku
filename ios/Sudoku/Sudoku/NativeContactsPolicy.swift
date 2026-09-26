import Contacts

enum NativeContactsPolicy {
    static func name(for status: CNAuthorizationStatus) -> String {
        if #available(iOS 18.0, *), status == .limited {
            return "limited"
        }

        switch status {
        case .notDetermined:
            return "not_determined"
        case .restricted:
            return "restricted"
        case .denied:
            return "denied"
        case .authorized:
            return "authorized"
        @unknown default:
            return "unknown"
        }
    }
}
