import UIKit

enum SudokuNativePalette {
    static let gameBackground = UIColor(red: 26 / 255, green: 26 / 255, blue: 26 / 255, alpha: 1)
    static let messengerBackground = UIColor(red: 248 / 255, green: 250 / 255, blue: 252 / 255, alpha: 1)
    static let accent = UIColor(red: 1, green: 138 / 255, blue: 0, alpha: 1)
    static let foreground = UIColor.white
    static let muted = UIColor(red: 161 / 255, green: 161 / 255, blue: 170 / 255, alpha: 1)
}

final class SudokuBrandMarkView: UIView {
    private let grid = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = UIColor(red: 33 / 255, green: 33 / 255, blue: 35 / 255, alpha: 1)
        layer.cornerRadius = 16
        layer.borderWidth = 1
        layer.borderColor = UIColor.white.withAlphaComponent(0.08).cgColor

        grid.axis = .vertical
        grid.spacing = 3
        grid.translatesAutoresizingMaskIntoConstraints = false
        addSubview(grid)

        for row in 0..<3 {
            let stack = UIStackView()
            stack.axis = .horizontal
            stack.distribution = .fillEqually
            stack.spacing = 3

            for column in 0..<3 {
                let cell = UIView()
                cell.layer.cornerRadius = 2
                let isAccent = (row == 0 && column == 2) || (row == 1 && column == 1) || (row == 2 && column == 0)
                cell.backgroundColor = isAccent
                    ? SudokuNativePalette.accent
                    : UIColor.white.withAlphaComponent(0.88)
                stack.addArrangedSubview(cell)
            }
            grid.addArrangedSubview(stack)
        }

        NSLayoutConstraint.activate([
            grid.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 13),
            grid.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -13),
            grid.topAnchor.constraint(equalTo: topAnchor, constant: 13),
            grid.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -13),
        ])

        isAccessibilityElement = false
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}
