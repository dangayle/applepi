// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "applepi-bridge",
    platforms: [
        .macOS(.v26)
    ],
    targets: [
        .executableTarget(
            name: "applepi-bridge",
            path: "Sources",
            swiftSettings: [
                .enableExperimentalFeature("Macros")
            ]
        )
    ]
)
