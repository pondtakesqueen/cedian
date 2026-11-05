//! Web Push from the daemon to the remote page's service worker (spec §6.5): the page
//! subscribes in the phone's browser, and a notification goes to the browser's push service
//! encrypted for that browser alone (RFC 8291, aes128gcm), signed with the daemon's VAPID key
//! (RFC 8292). The push service carries it and cannot read it.

use std::{
    io::{ErrorKind, Write as _},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use aes_gcm::{
    Aes128Gcm, KeyInit as _,
    aead::{Aead as _, Payload},
};
use anyhow::{Context as _, bail};
use hkdf::Hkdf;
use p256::{
    PublicKey, SecretKey,
    ecdsa::{Signature, SigningKey, signature::Signer as _},
    elliptic_curve::sec1::ToEncodedPoint as _,
};
use rand_core::{OsRng, RngCore as _};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// A browser's subscription, as `PushSubscription.toJSON()` gives it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Subscription {
    pub endpoint: String,
    pub keys: Keys,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Keys {
    pub p256dh: String,
    pub auth: String,
}

/// The push services a subscription may name: the browsers' own. Anything else is refused,
/// so the daemon only ever posts to them.
const SERVICES: &[&str] = &[
    ".push.apple.com",
    "fcm.googleapis.com",
    ".push.services.mozilla.com",
    ".notify.windows.com",
];

impl Subscription {
    /// The subscription when it is one the daemon will post to: an https endpoint of a known
    /// push service, and keys of the right shape.
    pub fn checked(self) -> anyhow::Result<Self> {
        let host = self
            .endpoint
            .strip_prefix("https://")
            .and_then(|rest| rest.split(['/', '?', '#']).next())
            .context("a push endpoint must be https")?;
        if host.contains(['@', ':']) || !SERVICES.iter().any(|s| service_host(host, s)) {
            bail!("{host} is not a browser's push service");
        }
        let key = decode(&self.keys.p256dh).context("p256dh")?;
        PublicKey::from_sec1_bytes(&key).context("p256dh is not a P-256 key")?;
        if decode(&self.keys.auth).context("auth")?.len() != 16 {
            bail!("auth must be 16 bytes");
        }
        Ok(self)
    }

    /// The endpoint's origin, the audience of the VAPID token.
    fn origin(&self) -> &str {
        let rest = &self.endpoint["https://".len()..];
        let end = rest.find('/').unwrap_or(rest.len());
        &self.endpoint[..("https://".len() + end)]
    }
}

fn service_host(host: &str, service: &str) -> bool {
    match service.strip_prefix('.') {
        Some(domain) => host.ends_with(service) && host.len() > service.len() || host == domain,
        None => host == service,
    }
}

/// The subscriptions in the state dir's `push-subscriptions.json`.
pub struct Subscriptions {
    path: PathBuf,
}

impl Subscriptions {
    pub fn new(state_dir: &Path) -> Self {
        Self {
            path: state_dir.join("push-subscriptions.json"),
        }
    }

    pub fn list(&self) -> Vec<Subscription> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|error| {
                log::warn!("{}: {error}", self.path.display());
                Vec::new()
            }),
            Err(_) => Vec::new(),
        }
    }

    /// Adds one, or replaces the one with the same endpoint.
    pub fn add(&self, subscription: Subscription) -> anyhow::Result<()> {
        let mut all = self.list();
        all.retain(|s| s.endpoint != subscription.endpoint);
        all.push(subscription);
        self.save(&all)
    }

    pub fn remove(&self, endpoint: &str) -> anyhow::Result<()> {
        let mut all = self.list();
        all.retain(|s| s.endpoint != endpoint);
        self.save(&all)
    }

    fn save(&self, all: &[Subscription]) -> anyhow::Result<()> {
        write_private(&self.path, &serde_json::to_vec_pretty(all)?)
    }
}

/// Writes a file only the owner can read, replacing it whole.
fn write_private(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    use std::os::unix::fs::OpenOptionsExt as _;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let temp = path.with_extension("tmp");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temp)
        .with_context(|| format!("writing {}", temp.display()))?;
    file.write_all(bytes)?;
    std::fs::rename(&temp, path).with_context(|| format!("replacing {}", path.display()))
}

/// The daemon's VAPID key in the state dir's `vapid-key`, made on first use.
pub fn vapid_key(state_dir: &Path) -> anyhow::Result<SigningKey> {
    let path = state_dir.join("vapid-key");
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            if let Some(bytes) = hex(text.trim())
                && let Ok(key) = SigningKey::from_slice(&bytes)
            {
                return Ok(key);
            }
        }
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error).with_context(|| format!("reading {}", path.display())),
    }
    let key = SigningKey::random(&mut OsRng);
    let text: String = key.to_bytes().iter().map(|b| format!("{b:02x}")).collect();
    write_private(&path, text.as_bytes())?;
    Ok(key)
}

/// The key's public half as the page passes it to `pushManager.subscribe`.
pub fn public_key(key: &SigningKey) -> String {
    encode(key.verifying_key().to_encoded_point(false).as_bytes())
}

/// RFC 8291: `message` encrypted for the browser that holds the subscription's keys, as one
/// aes128gcm record with its header. `server` and `salt` are fresh for each message.
pub fn encrypt(
    subscription: &Subscription,
    message: &[u8],
    server: &SecretKey,
    salt: [u8; 16],
) -> anyhow::Result<Vec<u8>> {
    let ua_public = decode(&subscription.keys.p256dh)?;
    let auth = decode(&subscription.keys.auth)?;
    let ua = PublicKey::from_sec1_bytes(&ua_public).context("p256dh")?;
    let as_public = server.public_key().to_encoded_point(false);
    let shared = p256::ecdh::diffie_hellman(server.to_nonzero_scalar(), ua.as_affine());

    let mut info = b"WebPush: info\0".to_vec();
    info.extend_from_slice(&ua_public);
    info.extend_from_slice(as_public.as_bytes());
    let mut ikm = [0u8; 32];
    Hkdf::<Sha256>::new(Some(&auth), shared.raw_secret_bytes())
        .expand(&info, &mut ikm)
        .map_err(|_| anyhow::anyhow!("hkdf"))?;
    let prk = Hkdf::<Sha256>::new(Some(&salt), &ikm);
    let mut cek = [0u8; 16];
    let mut nonce = [0u8; 12];
    prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
        .and_then(|()| prk.expand(b"Content-Encoding: nonce\0", &mut nonce))
        .map_err(|_| anyhow::anyhow!("hkdf"))?;

    // One record, so it is the last: the delimiter 2 and no padding.
    let mut plain = message.to_vec();
    plain.push(2);
    let sealed = Aes128Gcm::new(&cek.into())
        .encrypt(
            &nonce.into(),
            Payload {
                msg: &plain,
                aad: b"",
            },
        )
        .map_err(|_| anyhow::anyhow!("aes-gcm"))?;

    let mut out = salt.to_vec();
    out.extend_from_slice(&4096u32.to_be_bytes());
    out.push(as_public.as_bytes().len() as u8);
    out.extend_from_slice(as_public.as_bytes());
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// RFC 8292: the `Authorization` header's value for a post to `audience`, valid 12 hours.
pub fn vapid(key: &SigningKey, audience: &str, now: i64) -> String {
    let header = encode(br#"{"typ":"JWT","alg":"ES256"}"#);
    let claims = encode(
        serde_json::json!({
            "aud": audience,
            "exp": now + 12 * 60 * 60,
            "sub": "mailto:cedian-remote@example.com",
        })
        .to_string()
        .as_bytes(),
    );
    let signed = format!("{header}.{claims}");
    let signature: Signature = key.sign(signed.as_bytes());
    format!(
        "vapid t={signed}.{}, k={}",
        encode(&signature.to_bytes()),
        public_key(key)
    )
}

/// What a post came to.
#[derive(Debug, PartialEq)]
pub enum Sent {
    Delivered,
    /// The browser dropped the subscription (404 or 410): forget it.
    Gone,
}

/// Posts `message` to the subscription's push service with curl.
pub fn send(key: &SigningKey, subscription: &Subscription, message: &[u8]) -> anyhow::Result<Sent> {
    let mut salt = [0u8; 16];
    OsRng.fill_bytes(&mut salt);
    let body = encrypt(subscription, message, &SecretKey::random(&mut OsRng), salt)?;
    let now = chrono::Utc::now().timestamp();
    post(
        &subscription.endpoint,
        &vapid(key, subscription.origin(), now),
        &body,
    )
}

fn post(endpoint: &str, authorization: &str, body: &[u8]) -> anyhow::Result<Sent> {
    let mut child = Command::new("curl")
        .args([
            "-sS",
            "--max-time",
            "15",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code}",
        ])
        .args(["-H", &format!("Authorization: {authorization}")])
        .args(["-H", "Content-Encoding: aes128gcm"])
        .args(["-H", "Content-Type: application/octet-stream"])
        .args(["-H", "TTL: 86400", "-H", "Urgency: high"])
        .args(["--data-binary", "@-", "--", endpoint])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("running curl")?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(body)?;
    }
    let output = child.wait_with_output()?;
    let code = String::from_utf8_lossy(&output.stdout);
    match code.trim() {
        "200" | "201" | "202" => Ok(Sent::Delivered),
        "404" | "410" => Ok(Sent::Gone),
        code => bail!(
            "push to {endpoint}: HTTP {code} {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ),
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// base64url without padding.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk
            .iter()
            .enumerate()
            .fold(0u32, |n, (i, b)| n | u32::from(*b) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// base64url, padded or not; standard base64's `+` and `/` are taken too.
pub fn decode(text: &str) -> anyhow::Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut n = 0u32;
    let mut bits = 0;
    for c in text.trim_end_matches('=').bytes() {
        let v = match c {
            b'+' => 62,
            b'/' => 63,
            _ => ALPHABET
                .iter()
                .position(|a| *a == c)
                .context("not base64url")? as u32,
        };
        n = n << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((n >> bits) as u8);
            n &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

fn hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(text.get(i..i + 2)?, 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::{VerifyingKey, signature::Verifier as _};

    // RFC 8291, Appendix A.
    const PLAIN: &str = "When I grow up, I want to be a watermelon";
    const AS_PRIVATE: &str = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
    const UA_PRIVATE: &str = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
    const UA_PUBLIC: &str =
        "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const SALT: &str = "DGv6ra1nlYgDCS1FRnbzlw";
    const AUTH: &str = "BTBZMqHH6r4Tts7J_aSIgg";
    const SEALED: &str = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

    fn rfc_subscription() -> Subscription {
        Subscription {
            endpoint: "https://web.push.apple.com/abc".into(),
            keys: Keys {
                p256dh: UA_PUBLIC.into(),
                auth: AUTH.into(),
            },
        }
    }

    /// What the browser does with a record: RFC 8291 from the receiving side.
    fn decrypt(ua_private: &SecretKey, auth: &[u8], record: &[u8]) -> Vec<u8> {
        let salt = &record[..16];
        let id_len = record[20] as usize;
        let as_public = &record[21..21 + id_len];
        let sealed = &record[21 + id_len..];
        let ua_public = ua_private.public_key().to_encoded_point(false);
        let shared = p256::ecdh::diffie_hellman(
            ua_private.to_nonzero_scalar(),
            PublicKey::from_sec1_bytes(as_public)
                .expect("as key")
                .as_affine(),
        );
        let mut info = b"WebPush: info\0".to_vec();
        info.extend_from_slice(ua_public.as_bytes());
        info.extend_from_slice(as_public);
        let mut ikm = [0u8; 32];
        Hkdf::<Sha256>::new(Some(auth), shared.raw_secret_bytes())
            .expand(&info, &mut ikm)
            .expect("ikm");
        let prk = Hkdf::<Sha256>::new(Some(salt), &ikm);
        let (mut cek, mut nonce) = ([0u8; 16], [0u8; 12]);
        prk.expand(b"Content-Encoding: aes128gcm\0", &mut cek)
            .expect("cek");
        prk.expand(b"Content-Encoding: nonce\0", &mut nonce)
            .expect("nonce");
        let mut plain = Aes128Gcm::new(&cek.into())
            .decrypt(&nonce.into(), sealed)
            .expect("opens");
        assert_eq!(plain.pop(), Some(2), "the last record's delimiter");
        plain
    }

    #[test]
    fn encrypts_as_rfc_8291_appendix_a() {
        let server = SecretKey::from_slice(&decode(AS_PRIVATE).unwrap()).unwrap();
        let salt: [u8; 16] = decode(SALT).unwrap().try_into().unwrap();
        let record = encrypt(&rfc_subscription(), PLAIN.as_bytes(), &server, salt).unwrap();
        assert_eq!(encode(&record), SEALED);
        let ua = SecretKey::from_slice(&decode(UA_PRIVATE).unwrap()).unwrap();
        assert_eq!(
            decrypt(&ua, &decode(AUTH).unwrap(), &record),
            PLAIN.as_bytes()
        );
    }

    #[test]
    fn a_fresh_message_opens_in_the_browser_that_subscribed() {
        let ua = SecretKey::random(&mut OsRng);
        let mut auth = [0u8; 16];
        OsRng.fill_bytes(&mut auth);
        let subscription = Subscription {
            endpoint: "https://fcm.googleapis.com/fcm/send/x".into(),
            keys: Keys {
                p256dh: encode(ua.public_key().to_encoded_point(false).as_bytes()),
                auth: encode(&auth),
            },
        };
        let message = r#"{"title":"แอป","body":"ถามคุณ"}"#;
        let record = encrypt(
            &subscription,
            message.as_bytes(),
            &SecretKey::random(&mut OsRng),
            [7; 16],
        )
        .unwrap();
        assert_eq!(decrypt(&ua, &auth, &record), message.as_bytes());
    }

    #[test]
    fn the_vapid_token_names_the_push_service_and_verifies_with_the_page_s_key() {
        let key = SigningKey::random(&mut OsRng);
        let header = vapid(&key, "https://web.push.apple.com", 1_000);
        let (token, k) = header
            .strip_prefix("vapid t=")
            .and_then(|rest| rest.split_once(", k="))
            .unwrap();
        assert_eq!(k, public_key(&key));
        let (signed, signature) = token.rsplit_once('.').unwrap();
        let claims: serde_json::Value =
            serde_json::from_slice(&decode(signed.split('.').nth(1).unwrap()).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://web.push.apple.com");
        assert_eq!(claims["exp"], 1_000 + 12 * 3600);
        let verifying = VerifyingKey::from_sec1_bytes(&decode(k).unwrap()).unwrap();
        let signature = Signature::from_slice(&decode(signature).unwrap()).unwrap();
        verifying.verify(signed.as_bytes(), &signature).unwrap();
    }

    #[test]
    fn only_a_browser_push_service_is_taken() {
        let with = |endpoint: &str| Subscription {
            endpoint: endpoint.into(),
            ..rfc_subscription()
        };
        assert!(with("https://web.push.apple.com/QG").checked().is_ok());
        assert!(
            with("https://fcm.googleapis.com/fcm/send/x")
                .checked()
                .is_ok()
        );
        assert!(
            with("https://updates.push.services.mozilla.com/wpush/v2/x")
                .checked()
                .is_ok()
        );
        for bad in [
            "http://web.push.apple.com/x",
            "https://127.0.0.1/x",
            "https://evilpush.apple.com.example/x",
            "https://notpush.apple.com/x",
            "https://fcm.googleapis.com.evil/x",
            "https://user@fcm.googleapis.com/x",
            "https://fcm.googleapis.com:8443/x",
        ] {
            assert!(with(bad).checked().is_err(), "{bad}");
        }
        assert_eq!(
            with("https://web.push.apple.com/QG").origin(),
            "https://web.push.apple.com"
        );
    }

    #[test]
    fn base64url_round_trips() {
        for n in 0..10 {
            let bytes: Vec<u8> = (0..n).map(|i| (i * 37 + 200) as u8).collect();
            assert_eq!(decode(&encode(&bytes)).unwrap(), bytes);
        }
        assert_eq!(encode(b"\xfb\xff"), "-_8");
    }

    #[test]
    fn the_vapid_key_and_subscriptions_are_kept_for_the_owner_alone() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempfile::tempdir().unwrap();
        let key = vapid_key(dir.path()).unwrap();
        assert_eq!(
            public_key(&vapid_key(dir.path()).unwrap()),
            public_key(&key)
        );
        let mode = |name: &str| {
            std::fs::metadata(dir.path().join(name))
                .unwrap()
                .permissions()
                .mode()
                & 0o777
        };
        assert_eq!(mode("vapid-key"), 0o600);
        let subs = Subscriptions::new(dir.path());
        subs.add(rfc_subscription()).unwrap();
        subs.add(rfc_subscription()).unwrap();
        assert_eq!(subs.list().len(), 1);
        assert_eq!(mode("push-subscriptions.json"), 0o600);
        subs.remove("https://web.push.apple.com/abc").unwrap();
        assert!(subs.list().is_empty());
    }
}
