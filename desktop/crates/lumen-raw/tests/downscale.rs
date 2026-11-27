//! Box-Verkleinerung: Werte wie `boxDownscaleRgb16` im Web-Editor.

use lumen_raw::{Rgb16Image, box_downscale};

#[test]
fn kleines_bild_bleibt_unveraendert() {
    let img = Rgb16Image {
        width: 2,
        height: 1,
        data: vec![1, 2, 3, 4, 5, 6],
    };
    assert_eq!(box_downscale(&img, 512), img);
}

#[test]
fn halbierung_mittelt_bloecke() {
    // 4x2 -> 2x1: je 2x2-Block gemittelt.
    let mut data = Vec::new();
    for v in [0u16, 100, 1000, 3000, 200, 300, 2000, 4000] {
        data.extend_from_slice(&[v, v, v]);
    }
    let img = Rgb16Image {
        width: 4,
        height: 2,
        data,
    };
    let out = box_downscale(&img, 2);
    assert_eq!((out.width, out.height), (2, 1));
    assert_eq!(out.data, vec![150, 150, 150, 2500, 2500, 2500]);
}

#[test]
fn bruchteil_gewichte_und_rundung_wie_web() {
    // 3x1 -> 2x1, scale 1.5: Ziel 0 = p0 + 0.5*p1, Ziel 1 = 0.5*p1 + p2 (jeweils /1.5).
    let img = Rgb16Image {
        width: 3,
        height: 1,
        data: vec![0, 0, 0, 1, 1, 1, 65535, 65535, 65535],
    };
    let out = box_downscale(&img, 2);
    assert_eq!((out.width, out.height), (2, 1));
    // (0 + 0.5) / 1.5 = 0.333 -> 0; (0.5 + 65535) / 1.5 = 43690.33 -> 43690
    assert_eq!(out.data, vec![0, 0, 0, 43690, 43690, 43690]);
}

#[test]
fn zielgroesse_rundet_wie_harness() {
    // 6036x4020 -> 512x341 (Math.round(4020 * 512 / 6036) = 341)
    let img = Rgb16Image {
        width: 6036,
        height: 4020,
        data: vec![7; 6036 * 4020 * 3],
    };
    let out = box_downscale(&img, 512);
    assert_eq!((out.width, out.height), (512, 341));
    assert!(out.data.iter().all(|v| *v == 7));
}
