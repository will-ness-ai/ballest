// Every ball skin the game ships, by the object path a run's Ghost names it with (the
// skin column of the ghosts table, tools/ghosts.py), and the picture the site draws for it:
// the game's menu ball wearing the skin, shot in a test copy and cut round, at
// /skins/<asset>.webp from the root skins/ folder. The game shows no skin names, so the
// comments are ours. A path not listed here (a skin a game update added) draws the marble.
// How the list and the pictures were made: prototype/skins/ on branch
// claude/prototype-skins.
const SKINS = new Map<string, string>([
  // Pink
  ["/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink", "DA_Skin_Pink"],
  // Mid Red
  ["/Game/Art/Materials/Instances/Ball/MI_BallRedMid.MI_BallRedMid", "DA_Skin_RedMid"],
  // Red
  ["/Game/Art/Materials/Instances/Ball/MI_BallRed.MI_BallRed", "DA_Skin_Red"],
  // Gray
  ["/Game/Art/Materials/Instances/Ball/MI_BallGray.MI_BallGray", "DA_Skin_Gray"],
  // Purple
  ["/Game/Art/Materials/Instances/Ball/MI_BallPurple.MI_BallPurple", "DA_Skin_Purple"],
  // Mid Orange
  ["/Game/Art/Materials/Instances/Ball/MI_BallOrangeMid.MI_BallOrangeMid", "DA_Skin_OrangeMid"],
  // Lime Green
  ["/Game/Art/Materials/Instances/Ball/MI_BallLimeGreen.MI_BallLimeGreen", "DA_Skin_LimeGreen"],
  // Mid Green
  ["/Game/Art/Materials/Instances/Ball/MI_BallGreenMid.MI_BallGreenMid", "DA_Skin_GreenMid"],
  // Dark Red
  ["/Game/Art/Materials/Instances/Ball/MI_BallRedDark.MI_BallRedDark", "DA_Skin_RedDark"],
  // Yellow
  ["/Game/Art/Materials/Instances/Ball/MI_BallYellow.MI_BallYellow", "DA_Skin_Yellow"],
  // Turquoise
  ["/Game/Art/Materials/Instances/Ball/MI_BallTurquiose.MI_BallTurquiose", "DA_Skin_Turquiose"],
  // Dark Purple
  ["/Game/Art/Materials/Instances/Ball/MI_BallPurpleDark.MI_BallPurpleDark", "DA_Skin_PurpleDark"],
  // Dark Orange
  ["/Game/Art/Materials/Instances/Ball/MI_BallOrangeDark.MI_BallOrangeDark", "DA_Skin_OrangeDark"],
  // Orange
  ["/Game/Art/Materials/Instances/Ball/MI_BallOrange.MI_BallOrange", "DA_Skin_Orange"],
  // Green
  ["/Game/Art/Materials/Instances/Ball/MI_BallGreen.MI_BallGreen", "DA_Skin_Green"],
  // Mid Blue
  ["/Game/Art/Materials/Instances/Ball/MI_BallBlueMid.MI_BallBlueMid", "DA_Skin_BlueMid"],
  // Lavender
  ["/Game/Art/Materials/Instances/Ball/MI_BallLavender.MI_BallLavender", "DA_Skin_Lavender"],
  // Black
  ["/Game/Art/Materials/Instances/Ball/MI_BallBlack.MI_BallBlack", "DA_Skin_Default_Black"],
  // Light Pink
  ["/Game/Art/Materials/Instances/Ball/MI_BallPinkLight.MI_BallPinkLight", "DA_Skin_PinkLight"],
  // Blue
  ["/Game/Art/Materials/Instances/Ball/MI_BallBlue.MI_BallBlue", "DA_Skin_Default_Blue"],
  // Dark Blue
  ["/Game/Art/Materials/Instances/Ball/MI_BallBlueDark.MI_BallBlueDark", "DA_Skin_BlueDark"],
  // Dark Green
  ["/Game/Art/Materials/Instances/Ball/MI_BallGreenDark.MI_BallGreenDark", "DA_Skin_GreenDark"],
  // Gold
  ["/Game/Art/M_GoldReal.M_GoldReal", "DA_Skin_MedalGold"],
  // Silver
  ["/Game/Art/M_SilverReal.M_SilverReal", "DA_Skin_MedalSilver"],
  // Bronze
  ["/Game/Art/MI_BronzeReal.MI_BronzeReal", "DA_Skin_MedalBronze"],
  // Pearl
  ["/Game/Art/MI_PurplePearl.MI_PurplePearl", "DA_Skin_Pearl"],
  // Brick
  [
    "/Game/Packs/EPMasterMaterials/Materials/Instances/Examples/Default/MI_EP_BrickWallExample02a.MI_EP_BrickWallExample02a",
    "DA_Skin_Brick",
  ],
  // Eyeball
  ["/Game/Art/Materials/Instances/Ball/Import/M_EyeTest1.M_EyeTest1", "DA_Skin_EyeBall"],
  // Ice
  [
    "/Game/Packs/EPMasterMaterials/Materials/Instances/Examples/Glass/MI_EP_GlassExample01d.MI_EP_GlassExample01d",
    "DA_Skin_Ice",
  ],
  // Cosmic
  [
    "/Game/Packs/Vefects/Stylized_Galaxy_Shader/Galaxy/Materials/MI_VFX_Lush_Galaxy_Shader_02.MI_VFX_Lush_Galaxy_Shader_02",
    "DA_Skin_Cosmic1",
  ],
  // Magma
  ["/Game/Art/Materials/Masters/M_LavaBall.M_LavaBall", "DA_Skin_Magma"],
  // Leth
  ["/Game/Art/DataAssets/Skins/LBall/MI_LBall05.MI_LBall05", "DA_LBall"],
  // Snow Globe
  ["/Game/Art/VFX/SkinChildActors/BP_SnowGlobeSkin.BP_SnowGlobeSkin_C", "DA_Skin_SnowGlobe"],
  // Disco
  [
    "/Game/Packs/EPMasterMaterials/Materials/Masters/MI_Gridded_Inst.MI_Gridded_Inst",
    "DA_Skin_Disco",
  ],
  // Spirit
  ["/Game/Art/Materials/Cosmetics/Ball/Spirit/MM_SpiritBall.MM_SpiritBall", "DA_Skin_DevSilver"],
  // Spooky
  ["/Game/Art/Materials/Masters/M_GhastBall.M_GhastBall", "DA_SpookyBall"],
]);

/* the picture for a Ghost's skin, or null for none or one the site doesn't know */
export function skinPicture(skin: string | null | undefined): string | null {
  const asset = skin ? SKINS.get(skin) : undefined;
  return asset ? `/skins/${asset}.webp` : null;
}
