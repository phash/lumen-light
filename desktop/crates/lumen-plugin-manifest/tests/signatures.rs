mod common;
use common::{FIRST, SPEC};
use ed25519_dalek::{Signer, SigningKey};
use lumen_plugin_manifest::signatures::*;
use lumen_plugin_manifest::spec_toml_block;
use sha2::{Digest, Sha256};

fn b64(b: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(b)
}
fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}
fn kid(k: &SigningKey) -> String {
    format!(
        "ed25519:{}",
        hex(&Sha256::digest(k.verifying_key().as_bytes()))
    )
}

const ID: &str = "mrd.guided-denoise";
const VER: &str = "0.3.1";

fn publisher_toml(manifest: &[u8], k: &SigningKey) -> String {
    let sig = k.sign(&publisher_message(manifest, ID, VER));
    format!(
        "[publisher]\npubkey = \"{}\"\nkey-id = \"{}\"\nsig = \"{}\"\n",
        b64(k.verifying_key().as_bytes()),
        kid(k),
        b64(&sig.to_bytes())
    )
}

#[test]
fn publisher_signatur_rundlauf() {
    let manifest = spec_toml_block(SPEC, FIRST);
    let k = SigningKey::from_bytes(&[7u8; 32]);
    let s = parse_signatures(publisher_toml(manifest.as_bytes(), &k).as_bytes()).unwrap();
    let id = verify_publisher(manifest.as_bytes(), ID, VER, s.publisher.as_ref().unwrap()).unwrap();
    assert_eq!(
        id.0.as_slice(),
        Sha256::digest(k.verifying_key().as_bytes()).as_slice()
    );
}

#[test]
fn ein_byte_im_manifest_geaendert() {
    let manifest = spec_toml_block(SPEC, FIRST);
    let k = SigningKey::from_bytes(&[7u8; 32]);
    let s = parse_signatures(publisher_toml(manifest.as_bytes(), &k).as_bytes()).unwrap();
    let changed = manifest.replace("0.3.1", "0.3.2");
    assert_eq!(
        verify_publisher(changed.as_bytes(), ID, VER, s.publisher.as_ref().unwrap()),
        Err(SigError::BadSignature)
    );
    assert_eq!(
        verify_publisher(
            manifest.as_bytes(),
            ID,
            "0.3.2",
            s.publisher.as_ref().unwrap()
        ),
        Err(SigError::BadSignature)
    );
}

#[test]
fn key_id_passt_nicht() {
    let manifest = spec_toml_block(SPEC, FIRST);
    let k = SigningKey::from_bytes(&[7u8; 32]);
    let other = SigningKey::from_bytes(&[8u8; 32]);
    let t = publisher_toml(manifest.as_bytes(), &k).replace(&kid(&k), &kid(&other));
    let s = parse_signatures(t.as_bytes()).unwrap();
    assert_eq!(
        verify_publisher(manifest.as_bytes(), ID, VER, s.publisher.as_ref().unwrap()),
        Err(SigError::KeyIdMismatch)
    );
}

#[test]
fn zeitformat_streng() {
    for bad in [
        "2026-12-01T10:00:00+01:00",
        "2026-12-01 10:00:00Z",
        "2026-12-01T10:00:00.5Z",
        "2026-13-01T10:00:00Z",
        "2026-02-30T10:00:00Z",
    ] {
        assert!(
            matches!(parse_time(bad), Err(SigError::BadTime(_))),
            "{bad}"
        );
    }
    assert_eq!(parse_time("1970-01-01T00:00:00Z"), Ok(0));
    assert_eq!(parse_time("2026-12-01T10:00:00Z"), Ok(1_796_119_200));
    assert_eq!(parse_time("2028-02-29T00:00:00Z"), Ok(1_835_395_200));
}

fn marketplace_toml(
    manifest: &[u8],
    publisher: &SigningKey,
    counter: &SigningKey,
    root: &SigningKey,
    published: &str,
    not_after: &str,
) -> String {
    let p = publisher_toml(manifest, publisher);
    let psig = publisher
        .sign(&publisher_message(manifest, ID, VER))
        .to_bytes();
    let nb = "2026-01-01T00:00:00Z";
    let cert_sig = root.sign(&cert_message(
        "countersign",
        counter.verifying_key().as_bytes(),
        parse_time(nb).unwrap(),
        parse_time(not_after).unwrap(),
    ));
    let msig = counter.sign(&marketplace_message(
        manifest,
        ID,
        VER,
        "shader",
        "rv-2026-000123",
        parse_time(published).unwrap(),
        &psig,
    ));
    format!(
        "{p}\n[marketplace]\nkey-id = \"{}\"\nsig = \"{}\"\nreview-id = \"rv-2026-000123\"\npublished-at = \"{published}\"\n\n[marketplace.cert]\nrole = \"countersign\"\nkey = \"{}\"\nnot-before = \"{nb}\"\nnot-after = \"{not_after}\"\nroot-sig = \"{}\"\n",
        kid(counter),
        b64(&msig.to_bytes()),
        b64(counter.verifying_key().as_bytes()),
        b64(&cert_sig.to_bytes())
    )
}

#[test]
fn marketplace_kette() {
    let m = spec_toml_block(SPEC, FIRST);
    let (p, root, counter) = (
        SigningKey::from_bytes(&[7u8; 32]),
        SigningKey::from_bytes(&[9u8; 32]),
        SigningKey::from_bytes(&[11u8; 32]),
    );
    let rootpk = *root.verifying_key().as_bytes();
    let ok = parse_signatures(
        marketplace_toml(
            m.as_bytes(),
            &p,
            &counter,
            &root,
            "2026-12-01T10:00:00Z",
            "2027-03-01T00:00:00Z",
        )
        .as_bytes(),
    )
    .unwrap();
    assert_eq!(
        verify_marketplace(m.as_bytes(), ID, VER, "shader", &ok, &rootpk),
        Ok(())
    );
    assert_eq!(
        verify_marketplace(m.as_bytes(), ID, VER, "wasm", &ok, &rootpk),
        Err(SigError::BadSignature)
    );

    let late = parse_signatures(
        marketplace_toml(
            m.as_bytes(),
            &p,
            &counter,
            &root,
            "2027-04-01T00:00:00Z",
            "2027-03-01T00:00:00Z",
        )
        .as_bytes(),
    )
    .unwrap();
    assert_eq!(
        verify_marketplace(m.as_bytes(), ID, VER, "shader", &late, &rootpk),
        Err(SigError::CertExpiredAt(
            parse_time("2027-03-01T00:00:00Z").unwrap()
        ))
    );

    let wrong_root = *SigningKey::from_bytes(&[10u8; 32])
        .verifying_key()
        .as_bytes();
    assert_eq!(
        verify_marketplace(m.as_bytes(), ID, VER, "shader", &ok, &wrong_root),
        Err(SigError::BadSignature)
    );
}

#[test]
fn nachricht_layout() {
    let mut want = b"lumen-plugin-v1\0".to_vec();
    want.extend_from_slice(&Sha256::digest(b"x"));
    want.extend_from_slice(b"a.b\0");
    want.extend_from_slice(b"1.0.0\0");
    assert_eq!(publisher_message(b"x", "a.b", "1.0.0"), want);

    let mut want = b"lumen-cert-v1\0countersign\0".to_vec();
    want.extend_from_slice(&[1u8; 32]);
    want.extend_from_slice(&5u64.to_be_bytes());
    want.extend_from_slice(&6u64.to_be_bytes());
    assert_eq!(cert_message("countersign", &[1u8; 32], 5, 6), want);
}

#[test]
fn spec_signatures_block_parst() {
    let block = spec_toml_block(SPEC, "[publisher]");
    let s = parse_signatures(block.as_bytes()).expect("Spec-Block parst");
    assert!(s.publisher.is_some() && s.marketplace.is_some() && s.dev.is_some());
    let m = spec_toml_block(SPEC, FIRST);
    assert!(matches!(
        verify_publisher(m.as_bytes(), ID, VER, s.publisher.as_ref().unwrap()),
        Err(SigError::Format(_))
    ));
}

#[test]
fn unbekannter_schluessel_in_signatures() {
    assert!(matches!(
        parse_signatures(b"[publisher]\npubkey = \"a\"\nkey-id = \"b\"\nsig = \"c\"\nextra = 1\n"),
        Err(SigError::Format(_))
    ));
}
