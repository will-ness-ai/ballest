# Ball skins: what a ghost says and what each skin looks like

Gathered 2026-10-08 for the skin-on-the-site experiment. In-game work ran in sandboxed test copy 1 (menu and
Customize page only, no race). Will's own game was not touched.

## Files

- `skins.json`: the 36 skins the game ships (every `PDA_BallSkin_C`), one object each:
  - `asset`: the data asset name, which also names both PNGs.
  - `displayName`: our label. The game shows no skin names. The Customize tiles are icons only, and a locked tile
    shows its unlock hint instead ("Get the Author Medal on the Tower without checkpoints!!" on Cosmic).
  - `cosmeticName`: the asset's `CosmeticName`, an internal FName ("Cosmic", "SnowGlobeDEV", "Default_Blue").
  - `group`: the skin list the asset belongs to (`Basic Skins`, `Medal Skins`, `Collection`, `DevSkins`).
  - `skinMaterial`, `ghostSkinMaterial`, `specialSkinClass`: written exactly as a ghost writes them, so a ghost's
    fields can be looked up directly.
  - `materialPath`: the plain material path, or `null` for Snow Globe.
  - `special`, `animated`, `note`, `previewTexture`, and `shot`, which is `tile` when the shot came from pressing the
    skin's Customize tile and `forced` when the material or actor was put on the menu ball directly.
- `<asset>.png`: the menu ball on the Customize page, 256 px square, cropped from a 1280x720 shot, with the scene
  behind it (a dark backdrop and part of the gold ring). The site can round it with `border-radius: 50%`.
- `icons/<asset>.png`: the game's own tile icon, the asset's `PreviewTexture` (`T_Icon_*`) exported from the pak,
  64 px RGBA. These are what the Customize page shows. They are small but clean and consistent, and probably the
  better choice for a 16-32 px badge on a leaderboard row.

## Ghost fields

From 264 of Will's ghosts (`%LOCALAPPDATA%\Ballest\Saved\Ghosts`) and 409 other players' ghosts, fetched as the
site would: the top 15 of each Circuit board plus the top 5 of 30 Workshop Maps, through `GetUGCFileDetails` and
then the CDN JSON.

Raw samples:

```jsonc
// Will, Map 1 (local file), Silver medal skin
"skinMaterial": "/Script/Engine.Material'/Game/Art/M_SilverReal.M_SilverReal'",
"ghostSkinMaterial": "/Script/Engine.MaterialInstanceConstant'/Game/Art/MI_SilverReal_Ghost.MI_SilverReal_Ghost'",
"?SpecialSkinClass": "None",
"accessory": "None",
"accessoryGhostMaterial": "None",
"ballerSkinPrefs": {"bBasicBallTexture": true, "bBasicBallGloss": true, "basicBallTextureSliderValue": 100}

// ugc 10008697891986614519, Map_Track15, 2026-09-16: Cosmic with cat ears
"skinMaterial": "/Script/Engine.MaterialInstanceConstant'/Game/Packs/Vefects/Stylized_Galaxy_Shader/Galaxy/Materials/MI_VFX_Lush_Galaxy_Shader_02.MI_VFX_Lush_Galaxy_Shader_02'",
"ghostSkinMaterial": "/Script/Engine.MaterialInstanceConstant'/Game/Packs/Vefects/Stylized_Galaxy_Shader/Galaxy/Materials/MI_VFX_Lush_Galaxy_Shader_02_Ghost.MI_VFX_Lush_Galaxy_Shader_02_Ghost'",
"?SpecialSkinClass": "None",
"accessory": "/Script/Engine.StaticMesh'/Game/Art/Props/Player/CatEars/SM_CatEars_Combined.SM_CatEars_Combined'",
"accessoryGhostMaterial": "/Script/Engine.MaterialInstanceConstant'/Game/Art/Props/Player/CatEars/MI_CatEars_Ghost.MI_CatEars_Ghost'",
"ballerSkinPrefs": {"bBasicBallTexture": true, "bBasicBallGloss": false, "basicBallTextureSliderValue": 20.65217399597168}

// ugc 10866409329270169268, Map_Track_S2_TinyTower, 2026-10-03: Leth ball, a special actor
"skinMaterial": "/Script/Engine.MaterialInstanceConstant'/Game/Art/DataAssets/Skins/LBall/MI_LBall05.MI_LBall05'",
"ghostSkinMaterial": "/Script/Engine.MaterialInstanceConstant'/Game/Art/DataAssets/Skins/LBall/MI_LBall05_Ghost.MI_LBall05_Ghost'",
"?SpecialSkinClass": "/Script/Engine.BlueprintGeneratedClass'/Game/Art/Meshes/BP_LBall05.BP_LBall05_C'",
"accessory": "None",
"accessoryGhostMaterial": "None",
"ballerSkinPrefs": {"bBasicBallTexture": true, "bBasicBallGloss": true, "basicBallTextureSliderValue": 100}

// ugc 10119962546747947395, Map_Track19, 2025-11-08: Spooky, an old ghost
"skinMaterial": "/Script/Engine.Material'/Game/Art/Materials/Masters/M_GhastBall.M_GhastBall'",
"ghostSkinMaterial": "/Script/Engine.Material'/Game/Art/Materials/Masters/M_GhastBall.M_GhastBall'",
// no "?SpecialSkinClass" and no "ballerSkinPrefs" keys at all
"accessory": "None",
"accessoryGhostMaterial": "None"
```

What the samples show:

- **`skinMaterial` alone identifies the skin.** All 406 non-empty ghosts from other players, and all of Will's,
  map to exactly one of the 36 assets by `skinMaterial`. The only exception would be Snow Globe, whose asset has no
  material: its ghost would read `"skinMaterial": "None"` with `?SpecialSkinClass` naming `BP_SnowGlobeSkin_C`. It's a
  dev-list skin with no Customize tile, and no ghost in the sample uses it.
- **Look up on the material path, not the whole string.** The `/Script/Engine.Material'...'` and
  `MaterialInstanceConstant'...'` class prefixes are stable per asset, but matching on the inner path is safer.
- **Fields were added over time.** Ghosts from before about January 2026 have no `?SpecialSkinClass` key, and ghosts
  from before about July 2026 have no `ballerSkinPrefs`. A missing key is not the string `"None"`. The 2025
  ghosts in the sample (82 of 406) lack both.
- **Empty ghosts have no skin.** 3 ghosts have 0 samples (Track 18 twice, and one Workshop Map), and all their skin
  fields are `"None"`. They're the same "no replay" rows FINDINGS.md already lists.
- **`ballerSkinPrefs` changes how the 22 basic colours look.** It holds the texture slider (0-100, a float) and gloss
  on or off. Only 34 of the 311 non-empty ghosts that have the field use texture 100. Most use 0-25. At 100 a colour
  ball is a pale, marbled pastel; at 0 it's a flat, saturated colour. The colour PNGs here are shot at texture 0 with
  gloss on (the game's material parameter `ConcreteValue` set to 0 on the menu ball), which is closest to what most
  players run. A site that wants to be exact could tint by the slider value, but one image per colour reads fine.
- **`accessory` is the hat**, a StaticMesh path (cat ears 49, crown 34, pirate 18, top hat 12, ...). `"None"` on 241
  of 409. There's no hat catalogue here yet.

Popularity across both samples (Will's ghosts included, and top rows only, so biased toward fast players): Silver 110, Bronze 65 (mostly Will),
Cosmic 62, Ice 54, Red 51, Leth 51, Pearl 47, Black 29, Brick 23, Spooky 20. All 36 except Snow Globe appear at least
once.

## Skins that look wrong as a still

Measured from two shots 2 s apart (share of ball pixels that changed by more than 30/255): Spirit (`DA_Skin_DevSilver`)
84%, Disco 39%, Magma 12%, Spooky 3%, Snow Globe 0.6%, Cosmic 0.1%, every other skin 0%.

- **Spirit** cycles through colours: cyan in its icon, yellow and magenta in game. The PNG is one magenta frame.
- **Disco** has shimmering mirror facets. The still is fine.
- **Magma** has pulsing cracks. The still is fine.
- **Spooky** is not a ball: it's a translucent white ghost with a face, and its icon is a faint grey disc (alpha 0.19
  at most). Use the in-game PNG.
- **Leth** (`DA_LBall`) is a special actor (`BP_LBall05`, a camera-ball model) drawn over the sphere.
- **Snow Globe** is a special actor (`BP_SnowGlobeSkin`: glass globe, white base, red ornament, snow) with no material.
  I shot it by calling the menu ball's `SetSpecialBall`.
- **Ice** is refractive glass, so it looks light blue against the bright menu scene. The icon is nearly black.
- **Cosmic** was locked in the test save, so I shot it by setting its material on the menu ball's sphere. It looks the
  same as pressing the tile would.

## Icons vs in-game

The icons were rendered by the developers, likely from the same menu scene, and match the in-game look for every
skin except Ice (dark), Spooky (faint) and Spirit (one colour of the cycle). They are float16 RGBA (Ice's is BC7),
linear light, converted to sRGB here. Some have a transparent background and some are opaque on a dark backdrop. If
the site wants uniform icons, mask each to a circle.

## How it was gathered

- Skin table: host test command `skinmats`, then `objprop PDA_BallSkin_C DA <property>` for `PreviewTexture`,
  `?SpecialSkinClass` and `SkinGhostVariant`. `CosmeticName` and the skin-list membership came from the data assets'
  name maps and imports in the pak (`ballest-map-making/extract`).
- Shots: `call WBP_MainMenu_UIManager_C DoCustomize Transient`, `cosmode public`, then `cosmetictile -<n>` (the game's
  nth visible tile) and `shot`. The page shows 35 tiles, with Cosmic locked and Snow Globe not listed. The basic
  colours were then reshot at texture 0 with
  `callx StaticMeshComponent SetScalarParameterValueOnMaterials BP_MenuBall_C_3.Sphere | n:ConcreteValue | f:0`.
- Icons: the 36 `T_Icon_*` packages dumped with the extractor's CUE4Parse dumper and decoded by hand
  (`PF_FloatRGBA`, 64x64, pixels 12 bytes after the format name).
- I didn't export the skins' base-colour textures (optional step 4): the preview icons answered the same question.
