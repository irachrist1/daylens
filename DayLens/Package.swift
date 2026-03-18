// swift-tools-version: 5.9
// The swift-tools-version declares the minimum version of Swift required to build this package.

import PackageDescription

let package = Package(
    name: "DayLens",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "DayLens", targets: ["DayLens"])
    ],
    dependencies: [
        // GRDB — type-safe SQLite for Swift
        .package(
            url: "https://github.com/groue/GRDB.swift.git",
            from: "6.29.3"
        ),
        // Anthropic Swift SDK
        .package(
            url: "https://github.com/anthropics/anthropic-sdk-swift.git",
            from: "0.1.0"
        )
    ],
    targets: [
        .executableTarget(
            name: "DayLens",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "Anthropic", package: "anthropic-sdk-swift")
            ],
            path: "Sources/DayLens",
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        ),
        .testTarget(
            name: "DayLensTests",
            dependencies: [
                "DayLens",
                .product(name: "GRDB", package: "GRDB.swift")
            ],
            path: "Tests/DayLensTests"
        )
    ]
)
