import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    private weak var sudokuViewController: SudokuViewController?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let controller = SudokuViewController()
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = controller
        window.makeKeyAndVisible()

        self.window = window
        sudokuViewController = controller
    }

    func sceneWillResignActive(_ scene: UIScene) {
        sudokuViewController?.showPrivacyCover()
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        sudokuViewController?.hidePrivacyCoverAfterResume()
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        sudokuViewController?.showPrivacyCover()
    }
}
