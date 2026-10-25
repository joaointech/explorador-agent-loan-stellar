import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataTable } from "./table";

describe("DataTable", () => {
  it("clips absolutely positioned cells inside its own scroller", () => {
    // An `sr-only` header (position: absolute) whose containing block lies
    // outside the overflow-x-auto wrapper escapes it and makes the whole page
    // scroll sideways at 375 px (seen on /admin/cpcvs and /admin/agents).
    // The wrapper must be positioned so it is that containing block.
    const html = renderToStaticMarkup(
      <DataTable
        rows={[{ id: 1 }]}
        rowKey={(r) => r.id}
        columns={[
          { key: "id", header: "Note", cell: (r) => `#${r.id}` },
          { key: "actions", header: <span className="sr-only">Actions</span>, cell: () => "…" },
        ]}
      />,
    );
    const wrapper = html.match(/^<div class="([^"]*)"/)?.[1].split(" ") ?? [];
    expect(wrapper).toContain("overflow-x-auto");
    expect(wrapper).toContain("relative");
  });
});
