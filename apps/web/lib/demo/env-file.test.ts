import { describe, expect, it } from "vitest";

import { mergeEnvFile, parseEnvFile, parseValue } from "./env-file";

const TEMPLATE = `# comment line
DATABASE_URL=postgresql://advance:advance@localhost:5433/advance
SESSION_SECRET=                 # ≥ 32 random chars
EMAIL_FROM="explorador advance <advance@explorador.ai>"
ADMIN_SECRET=
`;

describe("parseValue", () => {
  it("strips inline comments from unquoted values and unquotes quoted ones", () => {
    expect(parseValue("                 # ≥ 32 random chars")).toBe("");
    expect(parseValue("abc # note")).toBe("abc");
    expect(parseValue('"Test SDF Network ; September 2015"')).toBe("Test SDF Network ; September 2015");
    expect(parseValue("'x # y'")).toBe("x # y");
  });
});

describe("mergeEnvFile", () => {
  it("fills empty keys in place, keeps comments and appends new keys", () => {
    const r = mergeEnvFile(TEMPLATE, { SESSION_SECRET: "s3cret", ADMIN_SECRET: "SADMIN", NEW_KEY: "v" });
    expect(r.set).toEqual(["SESSION_SECRET", "ADMIN_SECRET", "NEW_KEY"]);
    expect(r.kept).toEqual([]);
    expect(r.text).toContain("# comment line\n");
    expect(r.text).toContain("SESSION_SECRET=s3cret\n");
    expect(r.text).toContain('EMAIL_FROM="explorador advance <advance@explorador.ai>"\n');
    expect(r.text.trimEnd().endsWith("NEW_KEY=v")).toBe(true);
    const parsed = parseEnvFile(r.text);
    expect(parsed.get("ADMIN_SECRET")).toBe("SADMIN");
    expect(parsed.get("DATABASE_URL")).toBe("postgresql://advance:advance@localhost:5433/advance");
  });

  it("never clobbers a value that is already set unless forced", () => {
    const first = mergeEnvFile(TEMPLATE, { ADMIN_SECRET: "SFIRST" }).text;
    const again = mergeEnvFile(first, { ADMIN_SECRET: "SSECOND" });
    expect(again.kept).toEqual(["ADMIN_SECRET"]);
    expect(parseEnvFile(again.text).get("ADMIN_SECRET")).toBe("SFIRST");
    const forced = mergeEnvFile(first, { ADMIN_SECRET: "SSECOND" }, { force: true });
    expect(forced.set).toEqual(["ADMIN_SECRET"]);
    expect(parseEnvFile(forced.text).get("ADMIN_SECRET")).toBe("SSECOND");
  });

  it("drops duplicate assignments of a replaced key", () => {
    const r = mergeEnvFile("A=\nB=1\nA=\n", { A: "x" });
    expect(r.text).toBe("A=x\nB=1\n");
  });

  it("creates a file from nothing", () => {
    expect(mergeEnvFile("", { A: "1", B: "2" }).text).toBe("A=1\nB=2\n");
  });
});
