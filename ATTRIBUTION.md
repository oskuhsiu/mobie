# Attribution & Intellectual-Property Notice

This is a **non-commercial, personal-use hobby project** ("the Project"). It is **not affiliated with,
endorsed by, sponsored by, or approved by** Nintendo, Game Freak, Creatures Inc., The Pokémon Company,
PokéAPI, or any other rights holder named below.

The Project ships **no copyrighted game assets**. Artwork is loaded at runtime from third-party URLs
(see below), audio is procedurally synthesized at runtime, and 3D models are user-supplied drop-ins
that are never committed to this repository (`public/models/` is gitignored).

## Pokémon

**Pokémon**, the Pokémon character names, and all related names, marks, sprites, artwork, and game data
are **trademarks and copyright of Nintendo, Game Freak, Creatures Inc., and The Pokémon Company**.
They are used here under nominative/fair-use for a non-commercial fan project, **not** redistributed as
bundled assets, and remain the property of their respective owners.

- The Japanese arcade game **「ポケモンメザスタ」(Pokémon Mezastar)** by Marv / The Pokémon Company is
  the inspiration for the gameplay style. This Project is an independent fan clone of that *style* only.
- Species names (zh-Hant canonical names such as 海星星 / 寶石海星) are sourced as factual data and are
  the property of their respective owners.

## PokéAPI (data source)

Species data — names, types, base stats, evolution chains, and learnsets — is fetched from
**[PokéAPI](https://pokeapi.co)** at build time by `scripts/gen_dex.mjs` and committed as generated
data files under `src/game/data/`.

- The PokéAPI **software** is licensed under the BSD license; see <https://github.com/PokeAPI/pokeapi>.
- PokéAPI itself notes it is a non-affiliated, non-commercial project and that "Pokémon and Pokémon
  character names are trademarks of Nintendo."

**Sprites / artwork** are loaded at runtime directly from the PokéAPI sprites repository
(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/<id>.png`).
These images are **not** downloaded into, bundled with, or redistributed by this repository — the app
hot-links them at display time. They remain the property of their respective owners.
See <https://github.com/PokeAPI/sprites> for that repository's own license and terms.

## Third-party software

Runtime and tooling dependencies retain their own licenses (see each package and `package-lock.json`),
including React, Vite, Three.js / react-three-fiber / drei, Zustand, XState, framer-motion, Tone.js,
jsQR, qrcode, and fflate.

## Dragon Quest (planned, currently deprecated)

A planned "second monster source" from the **Dragon Quest** series (Square Enix) was **deprecated**
(no official open data API). If ever revisited: Dragon Quest, its monsters, and related marks are
trademarks/copyright of **Square Enix**; any such data would be treated like the Pokémon data above
(non-commercial reference, no bundled artwork — drop-in/placeholder only).

## Summary of the Project's asset policy

- No infringing assets are committed to this repository.
- Artwork = runtime hot-link to PokéAPI sprite URLs.
- Audio = procedurally synthesized (no samples).
- 3D models = user drop-in only (gitignored).
- All trademarks and copyrights are the property of their respective owners.

If you are a rights holder and have a concern, this being a private, non-commercial project, please
contact the repository owner.
