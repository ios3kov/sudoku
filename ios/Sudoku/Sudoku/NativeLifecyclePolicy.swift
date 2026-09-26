enum NativeLifecycleEvent: Equatable {
    case webLoaded
    case willResignActive
    case didBecomeActive
    case didEnterBackground
}

struct NativeLifecycleState: Equatable {
    private(set) var webReady = false
    private(set) var foregroundActive = true

    var startupVisible: Bool { !webReady }
    var privacyVisible: Bool { !foregroundActive }

    mutating func apply(_ event: NativeLifecycleEvent) {
        switch event {
        case .webLoaded:
            webReady = true
        case .willResignActive, .didEnterBackground:
            foregroundActive = false
        case .didBecomeActive:
            foregroundActive = true
        }
    }
}
