//! A bare C ABI over chasolver for the page's Worker (app/dead-worker.js): no imports, no wasm-bindgen. The page writes
//! a FEN's bytes into `buf()` and calls `solve(len, winner)`.
use std::str::FromStr;

use chasolver::{winnability, Winnability};
use chess::{Board, Color};

const BUF_LEN: usize = 256;
static mut BUF: [u8; BUF_LEN] = [0; BUF_LEN];

/// Where the page writes the FEN (at most 256 bytes).
#[no_mangle]
pub extern "C" fn buf() -> *mut u8 {
    std::ptr::addr_of_mut!(BUF) as *mut u8
}

/// Whether `winner` (0 White, 1 Black) can mate by any legal sequence from the FEN of `len` bytes in `buf()`:
/// 0 unwinnable, 1 winnable, 2 undecided (chasolver gave up), 3 a FEN it refuses.
#[no_mangle]
pub extern "C" fn solve(len: u32, winner: u32) -> u32 {
    let len = len as usize;
    if len > BUF_LEN || winner > 1 {
        return 3;
    }
    let bytes = unsafe { std::slice::from_raw_parts(std::ptr::addr_of!(BUF) as *const u8, len) };
    let Ok(fen) = std::str::from_utf8(bytes) else { return 3 };
    let Ok(board) = Board::from_str(fen) else { return 3 };
    let color = if winner == 0 { Color::White } else { Color::Black };
    match winnability(&board, color) {
        Some(Winnability::Unwinnable) => 0,
        Some(Winnability::Winnable { .. }) => 1,
        None => 2,
    }
}
