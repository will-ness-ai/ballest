"""
ONE-TIME: mint a Steam refresh token for the headless collector, and validate it.

You run this locally. It logs into YOUR Steam account (you type your password and
Steam Guard code — they are never stored or sent anywhere but Steam), then:
  1. prints your refresh token and saves it to tools/refresh_token.txt (gitignored),
  2. proves the whole pipeline by reading the top 5 of the Season 2 Overall board.

Take the printed token and store it as the GitHub Actions secret STEAM_REFRESH_TOKEN.
The token is long-lived; re-run this only if CI later reports the token expired.

Run:  (from repo root, in the steam.py venv — see tools/README-hosting.md)
      python tools/steampy_mint.py
"""
import os, sys, getpass, logging

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import campaign_common as cc

import warnings
warnings.filterwarnings("ignore")

import steam
from steam.protobufs import leaderboards

logging.basicConfig(level=logging.WARNING)

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_OUT = os.path.join(HERE, "refresh_token.txt")

USERNAME = os.environ.get("STEAM_USERNAME") or input("Steam username: ").strip()
PASSWORD = os.environ.get("STEAM_PASSWORD") or getpass.getpass("Steam password (hidden): ")

client = steam.Client()
_done = {"v": False}


@client.event
async def on_ready():
    if _done["v"]:
        return
    _done["v"] = True
    try:
        token = client.refresh_token
        with open(TOKEN_OUT, "w", encoding="utf-8") as f:
            f.write(str(token) + "\n")
        print("\n" + "=" * 70)
        print("REFRESH TOKEN (store as GitHub secret STEAM_REFRESH_TOKEN):\n")
        print(token)
        print("\nAlso saved to:", TOKEN_OUT, "(gitignored — do not commit)")
        print("=" * 70 + "\n")

        # Validate the full read path against one real board (read by ID, as the
        # collector does; find-by-name also works once the header's routing_app_id
        # is set — see ugc_discord_leaderboard.find_board_id).
        print("Validating: reading top 5 of Season 2 Overall...")
        lid = cc.LEADERBOARD_IDS["OverallLeaderboard_EASeason2"]
        msg = await client._state.ws.send_proto_and_wait(
            leaderboards.CMsgClientLbsGetLbEntries(
                leaderboard_id=lid, app_id=cc.APP_ID,
                range_start=1, range_end=5, leaderboard_data_request=0, steamids=[],
            )
        )
        print(f"  board id={lid} entry_count={msg.leaderboard_entry_count}")
        n = 0
        for e in msg.entries:
            print(f"  #{e.global_rank:<3} steamid={e.steam_id_user}  score={e.score}")
            n += 1
        if n:
            print(f"\n✓ SUCCESS — read {n} entries. The token works for headless collection.")
        else:
            print("\n⚠ Logged in but read 0 entries — tell Claude; may need a fallback.")
    except Exception:
        import traceback
        traceback.print_exc()
        print("\n⚠ Login succeeded but the validation read failed — share this output.")
    finally:
        await client.close()


def main():
    if not USERNAME or not PASSWORD:
        print("Username and password are required.")
        return 2
    print("Logging in... (if prompted with '>>>', type your Steam Guard code)")
    try:
        client.run(USERNAME, PASSWORD)
    except Exception as e:
        print(f"\nLogin failed: {e!r}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
