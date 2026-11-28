//! `SIGNATURES`-Format und Ed25519-Pruefung (Spec "Signaturen (`SIGNATURES`)").
//! Signiert werden die exakten Manifest-Bytes; Nachrichten sind domaenengetrennt.

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SigError {
    #[error("SIGNATURES ungültig: {0}")]
    Format(String),
    #[error("key-id passt nicht zum Schlüssel")]
    KeyIdMismatch,
    #[error("Zeitangabe `{0}` ungültig (erwartet JJJJ-MM-TTThh:mm:ssZ)")]
    BadTime(String),
    #[error("Signatur ungültig")]
    BadSignature,
    #[error("Gegensignatur-Zertifikat lief am {0} ab")]
    CertExpiredAt(u64),
    #[error("Publisher-Signatur fehlt")]
    MissingPublisher,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signatures {
    pub publisher: Option<PublisherSig>,
    pub marketplace: Option<MarketplaceSig>,
    pub dev: Option<DevSig>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct PublisherSig {
    pub pubkey: String,
    pub key_id: String,
    pub sig: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct MarketplaceSig {
    pub key_id: String,
    pub sig: String,
    pub review_id: String,
    pub published_at: String,
    pub cert: Cert,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Cert {
    pub role: String,
    pub key: String,
    pub not_before: String,
    pub not_after: String,
    pub root_sig: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct DevSig {
    pub key_id: String,
    pub sig: String,
}

/// Voller sha256 eines oeffentlichen Schluessels; Textform `ed25519:<64 hex>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyId(pub [u8; 32]);

impl KeyId {
    pub fn of(pubkey: &[u8; 32]) -> Self {
        KeyId(Sha256::digest(pubkey).into())
    }
    pub fn to_text(&self) -> String {
        let hex: String = self.0.iter().map(|b| format!("{b:02x}")).collect();
        format!("ed25519:{hex}")
    }
}

pub fn parse_signatures(bytes: &[u8]) -> Result<Signatures, SigError> {
    let text = std::str::from_utf8(bytes).map_err(|_| SigError::Format("kein UTF-8".into()))?;
    toml::from_str(text).map_err(|e| SigError::Format(e.message().to_string()))
}

fn sha(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}

fn push_str(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(0);
}

pub fn publisher_message(manifest: &[u8], id: &str, version: &str) -> Vec<u8> {
    let mut m = b"lumen-plugin-v1\0".to_vec();
    m.extend_from_slice(&sha(manifest));
    push_str(&mut m, id);
    push_str(&mut m, version);
    m
}

#[allow(clippy::too_many_arguments)]
pub fn marketplace_message(
    manifest: &[u8],
    id: &str,
    version: &str,
    tier: &str,
    review_id: &str,
    published_at: u64,
    publisher_sig: &[u8; 64],
) -> Vec<u8> {
    let mut m = b"lumen-marketplace-v1\0".to_vec();
    m.extend_from_slice(&sha(manifest));
    push_str(&mut m, id);
    push_str(&mut m, version);
    push_str(&mut m, tier);
    push_str(&mut m, review_id);
    m.extend_from_slice(&published_at.to_be_bytes());
    m.extend_from_slice(&sha(publisher_sig));
    m
}

pub fn cert_message(role: &str, key: &[u8; 32], not_before: u64, not_after: u64) -> Vec<u8> {
    let mut m = b"lumen-cert-v1\0".to_vec();
    push_str(&mut m, role);
    m.extend_from_slice(key);
    m.extend_from_slice(&not_before.to_be_bytes());
    m.extend_from_slice(&not_after.to_be_bytes());
    m
}

pub fn dev_message(manifest: &[u8], id: &str, version: &str, dev_pubkey: &[u8; 32]) -> Vec<u8> {
    let mut m = b"lumen-dev-v1\0".to_vec();
    m.extend_from_slice(&sha(manifest));
    push_str(&mut m, id);
    push_str(&mut m, version);
    m.extend_from_slice(&sha(dev_pubkey));
    m
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Nur `JJJJ-MM-TTThh:mm:ssZ` (UTC, ohne Bruchteile, ohne Zeitzone).
pub fn parse_time(s: &str) -> Result<u64, SigError> {
    let bad = || SigError::BadTime(s.to_string());
    let b = s.as_bytes();
    let shape = b.len() == 20
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b'T',
            13 | 16 => *c == b':',
            19 => *c == b'Z',
            _ => c.is_ascii_digit(),
        });
    if !shape {
        return Err(bad());
    }
    let n = |a: usize, z: usize| s[a..z].parse::<i64>().unwrap_or(-1);
    let (y, mo, d, h, mi, se) = (n(0, 4), n(5, 7), n(8, 10), n(11, 13), n(14, 16), n(17, 19));
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let mdays = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    if !(1..=12).contains(&mo)
        || d < 1
        || d > mdays[(mo - 1) as usize]
        || h > 23
        || mi > 59
        || se > 59
        || y < 1970
    {
        return Err(bad());
    }
    Ok((days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se) as u64)
}

fn b64<const N: usize>(s: &str, what: &str) -> Result<[u8; N], SigError> {
    let v = base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|_| SigError::Format(format!("{what}: kein Base64")))?;
    v.try_into()
        .map_err(|_| SigError::Format(format!("{what}: erwartet {N} Byte")))
}

fn check_key_id(text: &str, key: &[u8; 32]) -> Result<KeyId, SigError> {
    let id = KeyId::of(key);
    if id.to_text() == text {
        Ok(id)
    } else {
        Err(SigError::KeyIdMismatch)
    }
}

fn verify(key: &[u8; 32], msg: &[u8], sig: &[u8; 64]) -> Result<(), SigError> {
    let vk =
        VerifyingKey::from_bytes(key).map_err(|_| SigError::Format("Schlüssel ungültig".into()))?;
    vk.verify_strict(msg, &Signature::from_bytes(sig))
        .map_err(|_| SigError::BadSignature)
}

/// Prueft die Publisher-Signatur gegen den mitgelieferten Schluessel.
pub fn verify_publisher(
    manifest: &[u8],
    id: &str,
    version: &str,
    s: &PublisherSig,
) -> Result<KeyId, SigError> {
    let key: [u8; 32] = b64(&s.pubkey, "pubkey")?;
    let sig: [u8; 64] = b64(&s.sig, "sig")?;
    let kid = check_key_id(&s.key_id, &key)?;
    verify(&key, &publisher_message(manifest, id, version), &sig)?;
    Ok(kid)
}

/// Prueft ein Gegensignatur-Zertifikat gegen den einkompilierten Root-Schluessel.
pub fn verify_cert(c: &Cert, root: &[u8; 32]) -> Result<(), SigError> {
    let key: [u8; 32] = b64(&c.key, "cert.key")?;
    let sig: [u8; 64] = b64(&c.root_sig, "cert.root-sig")?;
    if c.role != "countersign" && c.role != "revocation" {
        return Err(SigError::Format(format!(
            "cert.role `{}` unbekannt",
            c.role
        )));
    }
    let msg = cert_message(
        &c.role,
        &key,
        parse_time(&c.not_before)?,
        parse_time(&c.not_after)?,
    );
    verify(root, &msg, &sig)
}

/// Prueft Publisher-Signatur, Zertifikat und Gegensignatur eines Marketplace-Pakets.
pub fn verify_marketplace(
    manifest: &[u8],
    id: &str,
    version: &str,
    tier: &str,
    s: &Signatures,
    root: &[u8; 32],
) -> Result<(), SigError> {
    let p = s.publisher.as_ref().ok_or(SigError::MissingPublisher)?;
    verify_publisher(manifest, id, version, p)?;
    let mk = s
        .marketplace
        .as_ref()
        .ok_or(SigError::Format("[marketplace] fehlt".into()))?;
    verify_cert(&mk.cert, root)?;
    if mk.cert.role != "countersign" {
        return Err(SigError::Format(
            "Zertifikat ist kein Gegensignatur-Zertifikat".into(),
        ));
    }
    let key: [u8; 32] = b64(&mk.cert.key, "cert.key")?;
    check_key_id(&mk.key_id, &key)?;
    let published = parse_time(&mk.published_at)?;
    let (nb, na) = (
        parse_time(&mk.cert.not_before)?,
        parse_time(&mk.cert.not_after)?,
    );
    if published > na {
        return Err(SigError::CertExpiredAt(na));
    }
    if published < nb {
        return Err(SigError::BadTime(mk.published_at.clone()));
    }
    let psig: [u8; 64] = b64(&p.sig, "sig")?;
    let sig: [u8; 64] = b64(&mk.sig, "marketplace.sig")?;
    verify(
        &key,
        &marketplace_message(manifest, id, version, tier, &mk.review_id, published, &psig),
        &sig,
    )
}
