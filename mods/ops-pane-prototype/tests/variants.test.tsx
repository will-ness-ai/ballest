import { expect, test } from "claude-code/testing";

const pane = (bodyColumns: number) =>
  ({
    plugin: "ops-pane-prototype",
    component: "Pane",
    requestId: "ops",
    props: {
      title: "Ballest ops · PROTOTYPE",
      isFocused: false,
      bodyColumns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const;

test("every variant and state draws, narrow and wide, in the terminal and Desktop", async ($, on) => {
  for (const surface of ["terminal", "desktop"] as const) {
    for (const cols of [44, 96]) {
      const ui = await $.ui.mount({ ...pane(cols), surface });
      for (let v = 0; v < 5; v++) {
        for (let s = 1; s <= 4; s++) {
          await ui.press({ key: `state-${s - 1}` });
          await ui.drawn();
        }
        await ui.press({ key: "tab-0" }).catch(() => undefined);
        await ui.press({ key: "next" });
      }
      expect((await ui.find({ type: "Text", text: /A · Ledger/ }))?.text).toContain("Ledger");
      await ui.unmount();
    }
  }
});
