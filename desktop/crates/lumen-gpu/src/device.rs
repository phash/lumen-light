//! GPU-Geraet und Quelltextur.

use lumen_raw::Rgb16Image;

use crate::error::GpuError;
use crate::half::{HALF_ONE, unorm16_half_lut};

/// Geraet, Queue und die Eckdaten des gewaehlten Adapters.
pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub adapter_info: wgpu::AdapterInfo,
    pub limits: wgpu::Limits,
}

impl Gpu {
    /// Geraet ohne Fenster. Backends: alle, ueberschreibbar per `WGPU_BACKEND`.
    pub fn headless() -> Result<Gpu, GpuError> {
        Self::headless_with(wgpu::Backends::all().with_env())
    }

    /// Geraet ohne Fenster auf genau den angegebenen Backends (ohne Env).
    /// Fordert die vollen Adapter-Limits an, nicht die WebGPU-Defaults.
    pub fn headless_with(backends: wgpu::Backends) -> Result<Gpu, GpuError> {
        if backends.is_empty() {
            return Err(GpuError::NoAdapter);
        }
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
            backends,
            ..wgpu::InstanceDescriptor::new_without_display_handle()
        });
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            force_fallback_adapter: false,
            compatible_surface: None,
            ..Default::default()
        }))
        .map_err(|_| GpuError::NoAdapter)?;
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("lumen-gpu"),
            required_limits: adapter.limits(),
            ..Default::default()
        }))
        .map_err(|e| GpuError::RequestDevice(e.to_string()))?;
        Ok(Self::from_parts(device, queue, &adapter))
    }

    /// Aus einem bestehenden Geraet (z. B. von egui-wgpu).
    pub fn from_parts(device: wgpu::Device, queue: wgpu::Queue, adapter: &wgpu::Adapter) -> Gpu {
        let limits = device.limits();
        Gpu {
            device,
            queue,
            adapter_info: adapter.get_info(),
            limits,
        }
    }
}

/// Quellbild als `Rgba16Float`-Textur (Half-Bits wie `float16.ts`, Alpha 1).
pub struct SourceTexture {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub width: u32,
    pub height: u32,
}

impl SourceTexture {
    /// Rechnet unorm16 auf der CPU in Half um und laedt die Textur hoch.
    pub fn upload(gpu: &Gpu, img: &Rgb16Image) -> Result<SourceTexture, GpuError> {
        let max = gpu.limits.max_texture_dimension_2d;
        if img.width > max || img.height > max {
            return Err(GpuError::TextureTooLarge {
                width: img.width,
                height: img.height,
                max,
            });
        }
        assert!(img.width > 0 && img.height > 0, "Rgb16Image: leeres Bild");
        let (w, h) = (img.width as usize, img.height as usize);
        assert_eq!(
            img.data.len(),
            w * h * 3,
            "Rgb16Image: Datenlaenge passt nicht"
        );
        let lut = unorm16_half_lut();
        let mut rgba = Vec::with_capacity(w * h * 4);
        for px in img.data.as_chunks::<3>().0 {
            rgba.extend_from_slice(&[
                lut[px[0] as usize],
                lut[px[1] as usize],
                lut[px[2] as usize],
                HALF_ONE,
            ]);
        }
        let size = wgpu::Extent3d {
            width: img.width,
            height: img.height,
            depth_or_array_layers: 1,
        };
        let texture = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("lumen-source"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba16Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        gpu.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(&rgba),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(img.width * 8),
                rows_per_image: Some(img.height),
            },
            size,
        );
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Ok(SourceTexture {
            texture,
            view,
            width: img.width,
            height: img.height,
        })
    }
}
