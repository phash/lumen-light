//! Render-Pipeline fuer `develop.wgsl`.

use wgpu::util::DeviceExt;

use crate::device::{Gpu, SourceTexture};
use crate::params::{ToneParams, Uniforms};

const SHADER: &str = include_str!("shaders/develop.wgsl");
const READBACK_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// Entwickelt eine Quelltextur mit den Ton-Reglern in ein Ziel.
///
/// Der Shader schreibt sRGB-kodierte Werte (wie WebGL in den RGBA8-
/// Drawingbuffer). Ziel-Formate mit `*Srgb` wuerden ein zweites Mal kodieren.
pub struct Developer {
    pipeline: wgpu::RenderPipeline,
    /// Eigene Pipeline fuer `render_to_rgba8`, falls `out_format` abweicht.
    readback_pipeline: Option<wgpu::RenderPipeline>,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    uniforms: wgpu::Buffer,
}

impl Developer {
    pub fn new(gpu: &Gpu, out_format: wgpu::TextureFormat) -> Developer {
        let device = &gpu.device;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("develop.wgsl"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("develop-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(
                            std::mem::size_of::<Uniforms>() as u64
                        ),
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("develop-pl"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let make = |format: wgpu::TextureFormat| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("develop"),
                layout: Some(&pipeline_layout),
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vs_main"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fs_main"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let pipeline = make(out_format);
        let readback_pipeline = (out_format != READBACK_FORMAT).then(|| make(READBACK_FORMAT));
        // Wie WebGL: CLAMP_TO_EDGE, LINEAR fuer Min- und Mag-Filter, keine Mipmaps.
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("develop-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let uniforms = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("develop-uniforms"),
            contents: bytemuck::bytes_of(&Uniforms::new(&ToneParams::default(), (1, 1))),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        Developer {
            pipeline,
            readback_pipeline,
            layout,
            sampler,
            uniforms,
        }
    }

    /// Rendert in `target` (Format = `out_format` aus `new`), Groesse `size`.
    pub fn render(
        &self,
        gpu: &Gpu,
        src: &SourceTexture,
        p: &ToneParams,
        target: &wgpu::TextureView,
        size: (u32, u32),
    ) {
        let mut encoder = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("develop"),
            });
        self.encode(gpu, &self.pipeline, &mut encoder, src, p, target, size);
        gpu.queue.submit([encoder.finish()]);
    }

    /// Rendert in Quellgroesse und liest RGBA8 zurueck (Zeilen von oben).
    pub fn render_to_rgba8(&self, gpu: &Gpu, src: &SourceTexture, p: &ToneParams) -> Vec<u8> {
        let (w, h) = (src.width, src.height);
        let target = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("develop-readback-target"),
            size: wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: READBACK_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = target.create_view(&wgpu::TextureViewDescriptor::default());
        let row = w * 4;
        let padded =
            row.div_ceil(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT) * wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
        let buffer = gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("develop-readback"),
            size: u64::from(padded) * u64::from(h),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let pipeline = self.readback_pipeline.as_ref().unwrap_or(&self.pipeline);
        let mut encoder = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("develop-readback"),
            });
        self.encode(gpu, pipeline, &mut encoder, src, p, &view, (w, h));
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(h),
                },
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        gpu.queue.submit([encoder.finish()]);
        let slice = buffer.slice(..);
        slice.map_async(wgpu::MapMode::Read, |r| {
            r.expect("Readback-Puffer nicht abbildbar");
        });
        gpu.device
            .poll(wgpu::PollType::wait_indefinitely())
            .expect("GPU-Poll fehlgeschlagen");
        let mapped = slice
            .get_mapped_range()
            .expect("Readback-Puffer nicht lesbar");
        let mut out = Vec::with_capacity((row * h) as usize);
        for y in 0..h as usize {
            let start = y * padded as usize;
            out.extend_from_slice(&mapped[start..start + row as usize]);
        }
        drop(mapped);
        buffer.unmap();
        out
    }

    #[allow(clippy::too_many_arguments)]
    fn encode(
        &self,
        gpu: &Gpu,
        pipeline: &wgpu::RenderPipeline,
        encoder: &mut wgpu::CommandEncoder,
        src: &SourceTexture,
        p: &ToneParams,
        target: &wgpu::TextureView,
        size: (u32, u32),
    ) {
        gpu.queue.write_buffer(
            &self.uniforms,
            0,
            bytemuck::bytes_of(&Uniforms::new(p, size)),
        );
        let bind_group = gpu.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("develop-bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: self.uniforms.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&src.view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("develop"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.draw(0..3, 0..1);
    }
}
