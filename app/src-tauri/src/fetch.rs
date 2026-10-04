//! Downloads an image the user dragged in from a web page.
//!
//! A web page controls the URL that gets dragged, so the URL is untrusted. The
//! guard here stops it from being used to reach things it shouldn't (SSRF):
//!   - only http(s), no embedded credentials, no local host names
//!   - every address a host name resolves to must be on the public internet;
//!     reqwest connects only to the addresses our resolver returns, so DNS
//!     rebinding can't swap in a private address after the check
//!   - every redirect hop is re-checked; no proxies (a proxy would resolve for us)
//!   - no cookies or auth are ever sent; size and time are capped

use std::{
    error::Error,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{Arc, OnceLock},
    time::Duration,
};

use reqwest::{
    dns::{Addrs, Name, Resolve, Resolving},
    header, redirect, Url,
};

use crate::sanitize::MAX_INPUT_BYTES;

const MAX_REDIRECTS: usize = 5;

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || o[0] == 0 // 0.0.0.0/8 "this network"
        || (o[0] == 100 && (o[1] & 0xC0) == 64) // 100.64.0.0/10 carrier-grade NAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24 protocol assignments
        || (o[0] == 198 && (o[1] & 0xFE) == 18) // 198.18.0.0/15 benchmarking
        || o[0] >= 240) // reserved
}

fn embedded_v4(seg: &[u16]) -> Ipv4Addr {
    Ipv4Addr::new((seg[0] >> 8) as u8, seg[0] as u8, (seg[1] >> 8) as u8, seg[1] as u8)
}

/// True only for addresses on the public internet.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            let s = v6.segments();
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4); // ::ffff:a.b.c.d
            }
            if s[..6].iter().all(|&x| x == 0) {
                return is_public_v4(embedded_v4(&s[6..])); // ::, ::1, ::a.b.c.d
            }
            if s[0] == 0x0064 && s[1] == 0xFF9B {
                return is_public_v4(embedded_v4(&s[6..])); // NAT64 64:ff9b::/96
            }
            if s[0] == 0x2002 {
                return is_public_v4(embedded_v4(&s[1..3])); // 6to4
            }
            !(v6.is_multicast()
                || (s[0] & 0xFE00) == 0xFC00 // unique local fc00::/7
                || (s[0] & 0xFFC0) == 0xFE80 // link-local fe80::/10
                || (s[0] & 0xFFC0) == 0xFEC0 // site-local (deprecated)
                || (s[0] == 0x2001 && s[1] == 0x0DB8)) // documentation
        }
    }
}

/// Rejects URLs that aren't plain public http(s) links. Applied to the first URL and every redirect.
pub fn check_url(url: &Url) -> Result<(), String> {
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("Only web links can be downloaded, not {other}: links")),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Links with embedded usernames or passwords aren't allowed".into());
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) if !is_public_v4(ip) => Err("That link points at a local or private address".into()),
        Some(url::Host::Ipv6(ip)) if !is_public_ip(IpAddr::V6(ip)) => Err("That link points at a local or private address".into()),
        Some(url::Host::Domain(d)) => {
            let d = d.trim_end_matches('.').to_ascii_lowercase();
            let local = !d.contains('.')
                || d == "localhost"
                || [".localhost", ".local", ".internal", ".lan", ".home.arpa"].iter().any(|s| d.ends_with(s));
            if local {
                Err("That link points at a local host name".into())
            } else {
                Ok(())
            }
        }
        Some(_) => Ok(()),
        None => Err("That link has no host".into()),
    }
}

/// Resolves host names and keeps only public addresses; fails if none are left.
struct PublicOnlyResolver;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let all: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), 0)).await?.collect();
            let public: Vec<SocketAddr> = all.into_iter().filter(|a| is_public_ip(a.ip())).collect();
            if public.is_empty() {
                return Err(format!("{host} resolves to a local or private address").into());
            }
            let addrs: Addrs = Box::new(public.into_iter());
            Ok(addrs)
        })
    }
}

fn client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(c) = CLIENT.get() {
        return Ok(c);
    }
    let c = reqwest::Client::builder()
        .dns_resolver(Arc::new(PublicOnlyResolver))
        .no_proxy()
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error("Too many redirects");
            }
            match check_url(attempt.url()) {
                Ok(()) => attempt.follow(),
                Err(e) => attempt.error(e),
            }
        }))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent(concat!("Board/", env!("CARGO_PKG_VERSION"), " (reference board; single image download)"))
        .build()
        .map_err(|e| e.to_string())?;
    Ok(CLIENT.get_or_init(|| c))
}

fn describe(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return "The download timed out".into();
    }
    // Surface the innermost cause (e.g. our resolver's "resolves to a private address").
    let mut msg = e.to_string();
    let mut src = e.source();
    while let Some(s) = src {
        msg = s.to_string();
        src = s.source();
    }
    format!("Download failed: {msg}")
}

pub struct Downloaded {
    pub bytes: Vec<u8>,
    /// Final URL without query string or fragment (those often carry access tokens).
    pub source: String,
}

pub async fn download(raw: &str) -> Result<Downloaded, String> {
    let url = Url::parse(raw.trim()).map_err(|_| "That isn't a valid link".to_string())?;
    check_url(&url)?;
    let mut resp = client()?
        .get(url)
        .header(header::ACCEPT, "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8")
        .send()
        .await
        .map_err(|e| describe(&e))?;
    if !resp.status().is_success() {
        return Err(format!("The site answered {}", resp.status()));
    }
    let ctype = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ctype.starts_with("text/html") {
        return Err("That link is a web page, not an image. Drag the image itself, or right-click it → Copy image.".into());
    }
    if resp.content_length().is_some_and(|n| n > MAX_INPUT_BYTES as u64) {
        return Err("That image is too large to download".into());
    }
    let mut source = resp.url().clone();
    source.set_query(None);
    source.set_fragment(None);

    let mut bytes = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| describe(&e))? {
        if bytes.len() + chunk.len() > MAX_INPUT_BYTES {
            return Err("That image is too large to download".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Downloaded { bytes, source: source.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_addresses() {
        let public = ["8.8.8.8", "1.1.1.1", "151.101.1.69", "2606:4700:4700::1111", "2a00:1450:4001::200e"];
        let private = [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "0.0.0.0", "255.255.255.255", "224.0.0.1", "198.18.0.1", "240.0.0.1",
            "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
            "64:ff9b::7f00:1", "2002:c0a8:0101::1", "2001:db8::1", "ff02::1",
        ];
        for ip in public {
            assert!(is_public_ip(ip.parse().unwrap()), "{ip} should be public");
        }
        for ip in private {
            assert!(!is_public_ip(ip.parse().unwrap()), "{ip} should be blocked");
        }
    }

    #[test]
    fn checks_urls() {
        let ok = |u: &str| check_url(&Url::parse(u).unwrap()).is_ok();
        assert!(ok("https://upload.wikimedia.org/a.png"));
        assert!(ok("http://example.com/img.jpg"));
        for bad in [
            "file:///etc/passwd",
            "ftp://example.com/a.png",
            "http://localhost:8080/admin",
            "http://api.localhost/x",
            "http://printer.local/scan.png",
            "http://intranet/logo.png",
            "http://127.0.0.1/x.png",
            "http://[::1]/x.png",
            "http://169.254.169.254/latest/meta-data/",
            "http://192.168.0.1/",
            "http://user:pass@example.com/a.png",
            "http://0x7f000001/x.png", // hex IPv4 literal, normalized by the URL parser
        ] {
            assert!(!ok(bad), "{bad} should be rejected");
        }
    }

    #[test]
    fn resolver_drops_private_answers() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let err = rt.block_on(async { PublicOnlyResolver.resolve("localhost".parse().unwrap()).await.err() });
        assert!(err.is_some(), "localhost must not resolve through the guard");
    }
}
