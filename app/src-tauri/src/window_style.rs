//! Windows 11 draws the user's accent color around undecorated windows that
//! have a shadow. Keep the shadow and rounded corners, but draw that border in
//! the app's own hairline color instead. Older Windows ignores the call.

use std::ffi::c_void;

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(hwnd: isize, attribute: u32, value: *const c_void, size: u32) -> i32;
}

const DWMWA_BORDER_COLOR: u32 = 34;
/// COLORREF is 0x00BBGGRR: #2A2826, the title bar's bottom hairline.
const HAIRLINE: u32 = 0x0026_282A;

pub fn quiet_border(hwnd: isize) {
    // Best effort: a failure only means the system border stays as it was.
    unsafe {
        let _ = DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, (&HAIRLINE as *const u32).cast(), 4);
    }
}
