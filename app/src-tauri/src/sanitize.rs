//! Every image entering a board is decoded and re-encoded here ("content
//! disarm and reconstruction"). What lands in `.board/assets` is a fresh file
//! written by our own encoder, so:
//!   - malformed or malicious files never reach the webview or an AI model: only
//!     pure-Rust (memory-safe) decoders ever see the original bytes
//!   - metadata (EXIF GPS location, camera serials, text chunks, ICC tricks) is dropped
//!   - decompression bombs are refused before any pixels are allocated

use std::io::Cursor;

use image::{
    codecs::jpeg::JpegEncoder, metadata::Orientation, DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits,
};

pub const MAX_INPUT_BYTES: usize = 40 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 100_000_000;
const MAX_SIDE: u32 = 20_000;
const MAX_ALLOC: u64 = 1 << 30;
const JPEG_QUALITY: u8 = 92;

pub struct Clean {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
    pub width: u32,
    pub height: u32,
}

pub fn sanitize(input: &[u8]) -> Result<Clean, String> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(format!("Image is over {} MB", MAX_INPUT_BYTES / (1024 * 1024)));
    }
    // Trust the bytes, not the file name or MIME type.
    let format = image::guess_format(input).map_err(|_| "Not a supported image (png, jpg, gif, webp, bmp)".to_string())?;
    if !matches!(format, ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::Gif | ImageFormat::WebP | ImageFormat::Bmp) {
        return Err(format!("Unsupported image type: {format:?}"));
    }

    let mut reader = ImageReader::with_format(Cursor::new(input), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);

    let mut decoder = reader.into_decoder().map_err(|e| format!("Couldn't read image: {e}"))?;
    let (w, h) = decoder.dimensions();
    if u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(format!("Image is too large ({w}×{h})"));
    }
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| format!("Couldn't decode image: {e}"))?;
    // Bake EXIF rotation into the pixels, since the EXIF itself is about to be dropped.
    img.apply_orientation(orientation);

    let (bytes, ext) = if format == ImageFormat::Jpeg {
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
            .encode_image(&img.to_rgb8())
            .map_err(|e| e.to_string())?;
        (out, "jpg")
    } else {
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, ImageFormat::Png).map_err(|e| e.to_string())?;
        (out.into_inner(), "png")
    };
    Ok(Clean { bytes, ext, width: img.width(), height: img.height() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_with_text(w: u32, h: u32, key: &str, text: &str) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w, h);
            enc.set_color(png::ColorType::Rgb);
            enc.set_depth(png::BitDepth::Eight);
            enc.add_text_chunk(key.into(), text.into()).unwrap();
            let mut writer = enc.write_header().unwrap();
            writer.write_image_data(&vec![200u8; (w * h * 3) as usize]).unwrap();
        }
        out
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0u32;
        for &b in bytes {
            crc ^= u32::from(b);
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    /// A tiny PNG whose header claims enormous dimensions: a classic decompression bomb.
    fn bomb_png(w: u32, h: u32) -> Vec<u8> {
        let mut out = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        let mut ihdr = b"IHDR".to_vec();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        out.extend_from_slice(&13u32.to_be_bytes());
        out.extend_from_slice(&ihdr);
        out.extend_from_slice(&crc32(&ihdr).to_be_bytes());
        // A few bytes of zlib data stand in for the gigabytes the header promises.
        let mut idat = b"IDAT".to_vec();
        idat.extend_from_slice(&[0x78, 0x9C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01]);
        out.extend_from_slice(&8u32.to_be_bytes());
        out.extend_from_slice(&idat);
        out.extend_from_slice(&crc32(&idat).to_be_bytes());
        out.extend_from_slice(&0u32.to_be_bytes());
        out.extend_from_slice(b"IEND");
        out.extend_from_slice(&crc32(b"IEND").to_be_bytes());
        out
    }

    #[test]
    fn reencodes_and_strips_metadata() {
        let input = png_with_text(32, 16, "Location", "SECRET-GPS-48.85,2.35");
        let clean = sanitize(&input).unwrap();
        assert_eq!((clean.width, clean.height, clean.ext), (32, 16, "png"));
        let haystack = String::from_utf8_lossy(&clean.bytes);
        assert!(!haystack.contains("SECRET-GPS"), "metadata survived re-encoding");
    }

    #[test]
    fn keeps_jpeg_as_jpeg() {
        let img = DynamicImage::new_rgb8(40, 30);
        let mut jpg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpg, 80).encode_image(&img.to_rgb8()).unwrap();
        let clean = sanitize(&jpg).unwrap();
        assert_eq!((clean.ext, clean.width, clean.height), ("jpg", 40, 30));
    }

    #[test]
    fn rejects_non_images_and_disguised_files() {
        assert!(sanitize(b"<svg onload=alert(1)>").is_err());
        assert!(sanitize(b"MZ\x90\x00 definitely an exe").is_err());
        assert!(sanitize(b"").is_err());
    }

    #[test]
    fn refuses_decompression_bombs_without_allocating() {
        let err = sanitize(&bomb_png(19_000, 19_000)).err().unwrap();
        assert!(err.contains("too large"), "{err}");
        assert!(sanitize(&bomb_png(60_000, 10)).is_err()); // over the per-side limit
    }

    #[test]
    fn refuses_oversized_input() {
        assert!(sanitize(&vec![0u8; MAX_INPUT_BYTES + 1]).is_err());
    }
}
