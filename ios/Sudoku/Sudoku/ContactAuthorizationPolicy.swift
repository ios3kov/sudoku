import Contacts

enum NativeContactsAuthorizationState: String {
    case notDetermined = "not_determined"
    case granted
    case limited
    case denied
    case restricted
}

enum ContactAuthorizationPolicy {
    static func state(for status: CNAuthorizationStatus) -> NativeContactsAuthorizationState {
        if #available(iOS 18.0, *), status == .limited {
            return .limited
        }

        switch status {
        case .authorized:
            return .granted
        case .denied:
            return .denied
        case .restricted:
            return .restricted
        case .notDetermined:
            return .notDetermined
        @unknown default:
            return .restricted
        }
    }
}
