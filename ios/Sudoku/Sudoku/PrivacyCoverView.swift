import UIKit

final class PrivacyCoverView: UIView {
    private let titleLabel = UILabel()
    private let gridView = SudokuGridView()

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = UIColor(red: 0.969, green: 0.961, blue: 0.937, alpha: 1)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "Sudoku"
        titleLabel.font = .systemFont(ofSize: 30, weight: .semibold)
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center

        gridView.translatesAutoresizingMaskIntoConstraints = false

        addSubview(titleLabel)
        addSubview(gridView)

        NSLayoutConstraint.activate([
            titleLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -170),

            gridView.centerXAnchor.constraint(equalTo: centerXAnchor),
            gridView.centerYAnchor.constraint(equalTo: centerYAnchor),
            gridView.widthAnchor.constraint(equalToConstant: 270),
            gridView.heightAnchor.constraint(equalTo: gridView.widthAnchor),
        ])

        isAccessibilityElement = true
        accessibilityLabel = "Sudoku"
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

private final class SudokuGridView: UIView {
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ rect: CGRect) {
        guard let context = UIGraphicsGetCurrentContext() else { return }

        let size = min(rect.width, rect.height)
        let cell = size / 9

        for index in 0...9 {
            let major = index % 3 == 0
            context.setLineWidth(major ? 2 : 0.5)
            context.setStrokeColor(UIColor.label.withAlphaComponent(major ? 0.5 : 0.18).cgColor)

            let offset = CGFloat(index) * cell

            context.move(to: CGPoint(x: offset, y: 0))
            context.addLine(to: CGPoint(x: offset, y: size))
            context.strokePath()

            context.move(to: CGPoint(x: 0, y: offset))
            context.addLine(to: CGPoint(x: size, y: offset))
            context.strokePath()
        }
    }
}
