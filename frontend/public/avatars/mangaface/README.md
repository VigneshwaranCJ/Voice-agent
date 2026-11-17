# MangaFace avatar parts

These PNG layers come from **MangaFace** by Milad Abdollahnia: <https://github.com/miladnia/MangaFace>. They were copied from the `manga_male_pack` folder at commit `29879c261832486c66b7361c5335ca77e4b2a980`. The project is released under the MIT License, which is included here in `LICENSE`.

Only the parts the voice character uses are vendored. The layer positions follow `manifest/manga_male_pack.yaml` in that repo, on its 180 × 187 canvas.

The artwork is not modified. Lip-sync works by swapping mouth images; blinking and head motion are CSS transforms applied in `src/components/MangaFaceAvatar.tsx`.
