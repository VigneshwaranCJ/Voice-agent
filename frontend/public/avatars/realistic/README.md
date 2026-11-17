# Realistic avatar models

All models come from the [TalkingHead](https://github.com/met4citizen/TalkingHead) repository by
Mika Suominen. The renderer, `@met4citizen/talkinghead` (npm), is MIT licensed. **Each model has its own
licence; check it before you ship.**

| In the app | File | Source | Licence | Commercial use |
|---|---|---|---|---|
| Nandhini, Divyadharshini | `woman.glb` (same model, different colours) | `avatars/mpfb.glb`, made with Blender + [MPFB](https://static.makehumancommunity.org/mpfb.html) (MakeHuman) | CC0 | **Yes** |
| Nandhika | `samples/brunette.glb` | `avatars/brunette.glb`, Ready Player Me | CC BY-NC 4.0 | **No** |
| Rashmi | `samples/avaturn.glb` | `avatars/avaturn.glb`, Avaturn | Avaturn terms, non-commercial | **No** (commercial use needs Avaturn's permission) |
| Aarya | `samples/vroid.glb` | `avatars/vroid.glb`, made with VRoid Studio (anime-style 3D) | non-commercial | **No** |

Nandhika, Rashmi and Aarya are for demos and development only. The editor marks them "Demo only" and shows a
warning. Before selling the product, remove them or replace them with models you have a commercial
licence for (any GLB with a Mixamo-compatible rig plus ARKit and Oculus viseme blendshapes works; see
the TalkingHead README, Appendix A). Add a model by appending to `REALISTIC_MODELS` in
`src/components/RealisticAvatar.tsx`.

Changes made here: `woman.glb` had its textures downscaled to at most 1024 px (opaque ones re-encoded
as JPEG), cutting it from about 37 MB to about 20 MB. The three samples are unchanged.
