import UIKit

final class PrivacyCoverView: UIView {
    private let snapshotView = UIImageView()
    private let fallbackView = UIView()
    private let mark = SudokuBrandMarkView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)

        backgroundColor = SudokuNativePalette.startupBackground

        snapshotView.translatesAutoresizingMaskIntoConstraints = false
        snapshotView.contentMode = .scaleAspectFill
        snapshotView.clipsToBounds = true
        snapshotView.isAccessibilityElement = false
        addSubview(snapshotView)

        fallbackView.translatesAutoresizingMaskIntoConstraints = false
        fallbackView.backgroundColor = SudokuNativePalette.startupBackground
        addSubview(fallbackView)

        mark.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        subtitleLabel.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.text = "SUDOKU.MOSCOW"
        titleLabel.font = .systemFont(ofSize: 19, weight: .bold)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = SudokuNativePalette.startupAccent
        titleLabel.textAlignment = .center

        subtitleLabel.text = "SUDOKU"
        subtitleLabel.font = .systemFont(ofSize: 11, weight: .semibold)
        subtitleLabel.adjustsFontForContentSizeCategory = true
        subtitleLabel.textColor = SudokuNativePalette.startupMuted
        subtitleLabel.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [mark, titleLabel, subtitleLabel])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        fallbackView.addSubview(stack)

        NSLayoutConstraint.activate([
            snapshotView.leadingAnchor.constraint(equalTo: leadingAnchor),
            snapshotView.trailingAnchor.constraint(equalTo: trailingAnchor),
            snapshotView.topAnchor.constraint(equalTo: topAnchor),
            snapshotView.bottomAnchor.constraint(equalTo: bottomAnchor),

            fallbackView.leadingAnchor.constraint(equalTo: leadingAnchor),
            fallbackView.trailingAnchor.constraint(equalTo: trailingAnchor),
            fallbackView.topAnchor.constraint(equalTo: topAnchor),
            fallbackView.bottomAnchor.constraint(equalTo: bottomAnchor),

            mark.widthAnchor.constraint(equalToConstant: 68),
            mark.heightAnchor.constraint(equalTo: mark.widthAnchor),
            stack.centerXAnchor.constraint(equalTo: fallbackView.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: fallbackView.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: fallbackView.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: fallbackView.safeAreaLayoutGuide.trailingAnchor, constant: -24),
        ])

        isAccessibilityElement = true
        accessibilityViewIsModal = true
        accessibilityLabel = "Sudoku privacy cover"
        setSnapshot(nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setSnapshot(_ image: UIImage?) {
        snapshotView.image = image
        snapshotView.isHidden = image == nil
        fallbackView.isHidden = image != nil
    }
}
