// Every ball skin the game ships, by the object path a run's Ghost names it with (the
// skin column of the ghosts table, tools/ghosts.py), and the picture the site draws for it:
// the game's menu ball wearing the skin, shot in a test copy and cut round, at
// /skins/<asset>.webp from the root skins/ folder. The game shows no skin names, so the
// names are ours; the groups and their order are the Chosen Skin picker's
// (components/player/SkinPicker.tsx). A path not listed here (a skin a game update added)
// draws the marble. How the list and the pictures were made: prototype/skins/ on branch
// claude/prototype-skins.
/* the Chosen Skin picker's groups, in order */
export const SKIN_GROUP_NAMES = ["Colours", "Metals", "Specials"] as const;
export type SkinGroup = (typeof SKIN_GROUP_NAMES)[number];

export interface SkinEntry {
  /* the object path a Ghost names it with, which a Chosen Skin is stored as */
  skin: string;
  asset: string;
  name: string;
  group: SkinGroup;
}

const LIST: ReadonlyArray<SkinEntry> = [
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallPink.MI_BallPink",
    asset: "DA_Skin_Pink",
    name: "Pink",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallPinkLight.MI_BallPinkLight",
    asset: "DA_Skin_PinkLight",
    name: "Light Pink",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallRed.MI_BallRed",
    asset: "DA_Skin_Red",
    name: "Red",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallRedMid.MI_BallRedMid",
    asset: "DA_Skin_RedMid",
    name: "Mid Red",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallRedDark.MI_BallRedDark",
    asset: "DA_Skin_RedDark",
    name: "Dark Red",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallOrange.MI_BallOrange",
    asset: "DA_Skin_Orange",
    name: "Orange",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallOrangeMid.MI_BallOrangeMid",
    asset: "DA_Skin_OrangeMid",
    name: "Mid Orange",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallOrangeDark.MI_BallOrangeDark",
    asset: "DA_Skin_OrangeDark",
    name: "Dark Orange",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallYellow.MI_BallYellow",
    asset: "DA_Skin_Yellow",
    name: "Yellow",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallLimeGreen.MI_BallLimeGreen",
    asset: "DA_Skin_LimeGreen",
    name: "Lime Green",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallGreen.MI_BallGreen",
    asset: "DA_Skin_Green",
    name: "Green",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallGreenMid.MI_BallGreenMid",
    asset: "DA_Skin_GreenMid",
    name: "Mid Green",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallGreenDark.MI_BallGreenDark",
    asset: "DA_Skin_GreenDark",
    name: "Dark Green",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallTurquiose.MI_BallTurquiose",
    asset: "DA_Skin_Turquiose",
    name: "Turquoise",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallBlue.MI_BallBlue",
    asset: "DA_Skin_Default_Blue",
    name: "Blue",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallBlueMid.MI_BallBlueMid",
    asset: "DA_Skin_BlueMid",
    name: "Mid Blue",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallBlueDark.MI_BallBlueDark",
    asset: "DA_Skin_BlueDark",
    name: "Dark Blue",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallLavender.MI_BallLavender",
    asset: "DA_Skin_Lavender",
    name: "Lavender",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallPurple.MI_BallPurple",
    asset: "DA_Skin_Purple",
    name: "Purple",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallPurpleDark.MI_BallPurpleDark",
    asset: "DA_Skin_PurpleDark",
    name: "Dark Purple",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallGray.MI_BallGray",
    asset: "DA_Skin_Gray",
    name: "Gray",
    group: "Colours",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/MI_BallBlack.MI_BallBlack",
    asset: "DA_Skin_Default_Black",
    name: "Black",
    group: "Colours",
  },
  {
    skin: "/Game/Art/M_GoldReal.M_GoldReal",
    asset: "DA_Skin_MedalGold",
    name: "Gold",
    group: "Metals",
  },
  {
    skin: "/Game/Art/M_SilverReal.M_SilverReal",
    asset: "DA_Skin_MedalSilver",
    name: "Silver",
    group: "Metals",
  },
  {
    skin: "/Game/Art/MI_BronzeReal.MI_BronzeReal",
    asset: "DA_Skin_MedalBronze",
    name: "Bronze",
    group: "Metals",
  },
  {
    skin: "/Game/Art/MI_PurplePearl.MI_PurplePearl",
    asset: "DA_Skin_Pearl",
    name: "Pearl",
    group: "Metals",
  },
  {
    skin: "/Game/Packs/EPMasterMaterials/Materials/Instances/Examples/Default/MI_EP_BrickWallExample02a.MI_EP_BrickWallExample02a",
    asset: "DA_Skin_Brick",
    name: "Brick",
    group: "Specials",
  },
  {
    skin: "/Game/Art/Materials/Instances/Ball/Import/M_EyeTest1.M_EyeTest1",
    asset: "DA_Skin_EyeBall",
    name: "Eyeball",
    group: "Specials",
  },
  {
    skin: "/Game/Packs/EPMasterMaterials/Materials/Instances/Examples/Glass/MI_EP_GlassExample01d.MI_EP_GlassExample01d",
    asset: "DA_Skin_Ice",
    name: "Ice",
    group: "Specials",
  },
  {
    skin: "/Game/Packs/Vefects/Stylized_Galaxy_Shader/Galaxy/Materials/MI_VFX_Lush_Galaxy_Shader_02.MI_VFX_Lush_Galaxy_Shader_02",
    asset: "DA_Skin_Cosmic1",
    name: "Cosmic",
    group: "Specials",
  },
  {
    skin: "/Game/Art/Materials/Masters/M_LavaBall.M_LavaBall",
    asset: "DA_Skin_Magma",
    name: "Magma",
    group: "Specials",
  },
  {
    skin: "/Game/Art/DataAssets/Skins/LBall/MI_LBall05.MI_LBall05",
    asset: "DA_LBall",
    name: "Leth",
    group: "Specials",
  },
  {
    skin: "/Game/Art/VFX/SkinChildActors/BP_SnowGlobeSkin.BP_SnowGlobeSkin_C",
    asset: "DA_Skin_SnowGlobe",
    name: "Snow Globe",
    group: "Specials",
  },
  {
    skin: "/Game/Packs/EPMasterMaterials/Materials/Masters/MI_Gridded_Inst.MI_Gridded_Inst",
    asset: "DA_Skin_Disco",
    name: "Disco",
    group: "Specials",
  },
  {
    skin: "/Game/Art/Materials/Cosmetics/Ball/Spirit/MM_SpiritBall.MM_SpiritBall",
    asset: "DA_Skin_DevSilver",
    name: "Spirit",
    group: "Specials",
  },
  {
    skin: "/Game/Art/Materials/Masters/M_GhastBall.M_GhastBall",
    asset: "DA_SpookyBall",
    name: "Spooky",
    group: "Specials",
  },
];

/* object path -> asset */
export const SKINS = new Map<string, string>(LIST.map((s) => [s.skin, s.asset]));

/* the picker's groups, in order, each skin in its order */
export const SKIN_GROUPS: ReadonlyArray<{ group: SkinGroup; skins: ReadonlyArray<SkinEntry> }> =
  SKIN_GROUP_NAMES.map((group) => ({ group, skins: LIST.filter((s) => s.group === group) }));

/* the picture for a Ghost's skin, or null for none or one the site doesn't know */
export function skinPicture(skin: string | null | undefined): string | null {
  const asset = skin ? SKINS.get(skin) : undefined;
  return asset ? `/skins/${asset}.webp` : null;
}

/* a skin's name, or "No skin" for none or one the site doesn't know */
export function skinName(skin: string | null | undefined): string {
  return LIST.find((s) => s.skin === skin)?.name ?? "No skin";
}
