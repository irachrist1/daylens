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
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.24.0")
    ],
    targets: [
        .target(
            name: "ActivityAnalystCore",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift")
            ],
            path: "ActivityAnalyst",
            exclude: ["Resources", "App/ActivityAnalystApp.swift", "Services/Capture", "Services/Privacy/PermissionManager.swift", "Services/Privacy/DataExporter.swift"],
            sources: ["Models", "Services", "Utilities"]
        ),
        .testTarget(
            name: "ActivityAnalystTests",
            dependencies: ["ActivityAnalystCore"],
            path: "Tests/ActivityAnalystTests",
            resources: [.copy("Fixtures")]
        )
    ]
)
