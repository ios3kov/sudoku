import UIKit

final class PrivacyCoverView: UIView {
    private let snapshotView = UIImageView()
    private let titleLabel = UILabel()
    private let gridView = SudokuGridView()
    private let fallbackStack = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = UIColor(red: 0.969, green: 0.961, blue: 0.937, alpha: 1)

        snapshotView.translatesAutoresizingMaskIntoConstraints = false
        snapshotView.contentMode = .scaleAspectFill
        snapshotView.clipsToBounds = true
        snapshotView.isAccessibilityElement = false
        addSubview(snapshotView)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.text = "Sudoku"
        titleLabel.font = .preferredFont(forTextStyle: .largeTitle)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 0
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center

        gridView.translatesAutoresizingMaskIntoConstraints = false

        fallbackStack.axis = .vertical
        fallbackStack.alignment = .center
        fallbackStack.spacing = 20
        fallbackStack.translatesAutoresizingMaskIntoConstraints = false
        fallbackStack.addArrangedSubview(titleLabel)
        fallbackStack.addArrangedSubview(gridView)
        addSubview(fallbackStack)

        let preferredGridWidth = gridView.widthAnchor.constraint(equalToConstant: 270)
        preferredGridWidth.priority = .defaultHigh
        titleLabel.setContentCompressionResistancePriority(.required, for: .vertical)
        NSLayoutConstraint.activate([
            snapshotView.leadingAnchor.constraint(equalTo: leadingAnchor),
            snapshotView.trailingAnchor.constraint(equalTo: trailingAnchor),
            snapshotView.topAnchor.constraint(equalTo: topAnchor),
            snapshotView.bottomAnchor.constraint(equalTo: bottomAnchor),

            fallbackStack.centerXAnchor.constraint(equalTo: centerXAnchor),
            fallbackStack.centerYAnchor.constraint(equalTo: centerYAnchor),
            fallbackStack.leadingAnchor.constraint(
                greaterThanOrEqualTo: safeAreaLayoutGuide.leadingAnchor,
                constant: 20
            ),
            fallbackStack.trailingAnchor.constraint(
                lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor,
                constant: -20
            ),
            fallbackStack.topAnchor.constraint(
                greaterThanOrEqualTo: safeAreaLayoutGuide.topAnchor,
                constant: 20
            ),
            fallbackStack.bottomAnchor.constraint(
                lessThanOrEqualTo: safeAreaLayoutGuide.bottomAnchor,
                constant: -20
            ),
            preferredGridWidth,
            gridView.heightAnchor.constraint(equalTo: gridView.widthAnchor),
        ])

        isAccessibilityElement = true
        accessibilityViewIsModal = true
        accessibilityLabel = "Sudoku"
        setSnapshot(nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setSnapshot(_ image: UIImage?) {
        snapshotView.image = image
        snapshotView.isHidden = image == nil
        fallbackStack.isHidden = image != nil
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
