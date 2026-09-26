import UIKit

enum NativeSurface: String, Equatable {
    case sudoku
    case messenger
}

enum NativeSurfacePolicy {
    static func background(for surface: NativeSurface) -> UIColor {
        switch surface {
        case .sudoku:
            return SudokuNativePalette.gameBackground
        case .messenger:
            return SudokuNativePalette.messengerBackground
        }
    }

    static func statusBarStyle(for surface: NativeSurface) -> UIStatusBarStyle {
        switch surface {
        case .sudoku:
            return .lightContent
        case .messenger:
            return .darkContent
        }
    }
}
