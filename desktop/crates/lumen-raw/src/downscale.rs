//! Flaechen-Box-Verkleinerung, 1:1-Port von `boxDownscaleRgb16`
//! (`frontend/src/editor/rawPixels.ts`) inklusive Zielgroessen-Rundung des
//! Golden-Harness (`frontend/golden/harness.ts:targetSize`).
//!
//! Gleiche Zahlentypen wie im Web: Gewichte und Zeilenpuffer f32, die
//! Einzelsummen in f64 (JS-Number), Endrundung wie `Math.round`.

use crate::Rgb16Image;

/// Pro Zielindex: erster Quellindex, Anzahl, Offset in `weights`.
struct AxisWeights {
    start: Vec<usize>,
    count: Vec<usize>,
    offset: Vec<usize>,
    weights: Vec<f32>,
}

/// Flaechen-Gewichte einer Achse: Zielpixel i deckt [i*s, (i+1)*s) ab.
fn axis_weights(src_len: usize, dst_len: usize) -> AxisWeights {
    let scale = src_len as f64 / dst_len as f64;
    let mut aw = AxisWeights {
        start: Vec::with_capacity(dst_len),
        count: Vec::with_capacity(dst_len),
        offset: Vec::with_capacity(dst_len),
        weights: Vec::new(),
    };
    for i in 0..dst_len {
        let a = i as f64 * scale;
        let b = ((i + 1) as f64 * scale).min(src_len as f64);
        let i0 = a.floor() as usize;
        let i1 = (b.ceil() as usize).min(src_len);
        aw.start.push(i0);
        aw.count.push(i1 - i0);
        aw.offset.push(aw.weights.len());
        for j in i0..i1 {
            let cover = ((j + 1) as f64).min(b) - (j as f64).max(a);
            aw.weights.push((cover / scale) as f32);
        }
    }
    aw
}

/// Zielgroesse wie der Golden-Harness: lange Kante auf `max_long_edge`, gerundet.
fn target_size(width: u32, height: u32, max_long_edge: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= max_long_edge {
        return (width, height);
    }
    let scale = f64::from(max_long_edge) / f64::from(long);
    let w = (f64::from(width) * scale).round().max(1.0) as u32;
    let h = (f64::from(height) * scale).round().max(1.0) as u32;
    (w, h)
}

/// Verkleinert auf lange Kante `max_long_edge` (kleinere Bilder unveraendert).
pub fn box_downscale(img: &Rgb16Image, max_long_edge: u32) -> Rgb16Image {
    let (tw, th) = target_size(img.width, img.height, max_long_edge.max(1));
    if (tw, th) == (img.width, img.height) {
        return img.clone();
    }
    let (w, h) = (img.width as usize, img.height as usize);
    let (tw, th) = (tw as usize, th as usize);
    let xs = axis_weights(w, tw);
    let ys = axis_weights(h, th);
    let data = &img.data;

    let mut out = vec![0u16; tw * th * 3];
    let mut acc = vec![0f32; tw * 3];
    let mut row_a = vec![0f32; tw * 3];
    let mut row_b = vec![0f32; tw * 3];
    let mut cached_row = usize::MAX;

    let reduce_row = |sy: usize, target: &mut [f32]| {
        let base = sy * w * 3;
        for ox in 0..tw {
            let wo = xs.offset[ox];
            let mut i = base + xs.start[ox] * 3;
            let (mut r, mut g, mut b) = (0f64, 0f64, 0f64);
            for &wt in &xs.weights[wo..wo + xs.count[ox]] {
                let wt = f64::from(wt);
                r += f64::from(data[i]) * wt;
                g += f64::from(data[i + 1]) * wt;
                b += f64::from(data[i + 2]) * wt;
                i += 3;
            }
            let o = ox * 3;
            target[o] = r as f32;
            target[o + 1] = g as f32;
            target[o + 2] = b as f32;
        }
    };

    for oy in 0..th {
        acc.fill(0.0);
        let y0 = ys.start[oy];
        let wo = ys.offset[oy];
        for k in 0..ys.count[oy] {
            let sy = y0 + k;
            if sy != cached_row {
                reduce_row(sy, &mut row_b);
                // Zuletzt reduzierte Zeile merken (Randzeile der naechsten Zielzeile).
                std::mem::swap(&mut row_a, &mut row_b);
                cached_row = sy;
            }
            let wt = f64::from(ys.weights[wo + k]);
            for (a, r) in acc.iter_mut().zip(&row_a) {
                *a = (f64::from(*a) + f64::from(*r) * wt) as f32;
            }
        }
        let o = oy * tw * 3;
        for (dst, a) in out[o..o + tw * 3].iter_mut().zip(&acc) {
            // Math.round: halbe Werte nach oben; fuer Werte >= 0 identisch zu f64::round.
            let v = f64::from(*a).round();
            *dst = v.clamp(0.0, 65535.0) as u16;
        }
    }

    Rgb16Image {
        width: tw as u32,
        height: th as u32,
        data: out,
    }
}
