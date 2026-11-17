# Realistic avatar model

`woman.glb` is `avatars/mpfb.glb` from [TalkingHead](https://github.com/met4citizen/TalkingHead)
by Mika Suominen. Per the TalkingHead README it was created with Blender and
[MPFB](https://static.makehumancommunity.org/mpfb.html) (MakeHuman) and is licensed **CC0**
(public domain), so it may be shipped in commercial products.

Changes made here: textures downscaled to at most 1024 px (opaque ones re-encoded as JPEG) to cut
the file from about 37 MB to about 20 MB. Geometry, rig and blendshapes (ARKit + Oculus visemes) are
unchanged.

The renderer, `@met4citizen/talkinghead` (npm), is MIT licensed.

Do not swap in TalkingHead's other sample avatars (brunette, avaturn, avatarsdk, vroid) for
production: they are licensed for non-commercial use only.
