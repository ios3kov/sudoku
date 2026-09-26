import UIKit

final class StartupView: UIView {
    private let mark = SudokuBrandMarkView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = SudokuNativePalette.gameBackground

        mark.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.text = "SUDOKU.MOSCOW"
        titleLabel.textAlignment = .center
        titleLabel.textColor = SudokuNativePalette.accent
        titleLabel.font = .systemFont(ofSize: 19, weight: .bold)
        titleLabel.adjustsFontForContentSizeCategory = true

        subtitleLabel.text = "PRIVATE MESSENGER"
        subtitleLabel.textAlignment = .center
        subtitleLabel.textColor = SudokuNativePalette.muted
        subtitleLabel.font = .systemFont(ofSize: 11, weight: .semibold)
        subtitleLabel.adjustsFontForContentSizeCategory = true

        let stack = UIStackView(arrangedSubviews: [mark, titleLabel, subtitleLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            mark.widthAnchor.constraint(equalToConstant: 72),
            mark.heightAnchor.constraint(equalTo: mark.widthAnchor),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor, constant: -24),
        ])

        isAccessibilityElement = true
        accessibilityViewIsModal = true
        accessibilityLabel = "SUDOKU.MOSCOW loading"
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}
