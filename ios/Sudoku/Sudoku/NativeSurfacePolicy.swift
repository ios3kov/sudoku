import UIKit

enum NativeSurface: String, Equatable {
    case sudoku
    case messenger
}

enum NativeSurfacePolicy {
    static func background(for surface: NativeSurface) -> UIColor {
        switch surface {
        case .sudoku:
            return SudokuNativePalette.sudokuBackground
        case .messenger:
            return SudokuNativePalette.messengerBackground
        }
    }

    static func statusBarStyle(for surface: NativeSurface) -> UIStatusBarStyle {
        // Both current web surfaces are light.
        return .darkContent
    }
}
