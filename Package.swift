// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ActivityAnalyst",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "ActivityAnalystCore",
            targets: ["ActivityAnalystCore"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.24.0"),
        .package(url: "https://github.com/fumito-ito/AnthropicSwiftSDK.git", from: "0.14.0")
    ],
    targets: [
        .target(
            name: "ActivityAnalystCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift")
            ],
            path: "ActivityAnalyst",
            exclude: ["Resources", "App/ActivityAnalystApp.swift"],
            sources: ["Models", "Services", "ViewModels", "Utilities"]
        ),
        .testTarget(
            name: "ActivityAnalystTests",
            dependencies: ["ActivityAnalystCore"],
            path: "Tests/ActivityAnalystTests",
            resources: [.copy("Fixtures")]
        )
    ]
)
