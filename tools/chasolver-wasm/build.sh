#!/bin/sh
# Builds vendor/chasolver.wasm from this crate (Cargo.lock pins every dependency) and prints its SHA-256 for LAYOUT.md.
# Needs rustup: rust-toolchain.toml here pins the Rust that built the pinned file (rustup fetches it, with the
# wasm32-unknown-unknown target, on first use).
set -e
cd "$(dirname "$0")"
cargo build --release --locked --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/chasolver_wasm.wasm ../../vendor/chasolver.wasm
rustc --version
wc -c ../../vendor/chasolver.wasm
sha256sum ../../vendor/chasolver.wasm
