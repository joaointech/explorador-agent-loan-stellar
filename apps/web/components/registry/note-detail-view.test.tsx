// The note detail page rendered to HTML with a mocked GET /api/registry/[id]
// body built from the committed fixture proof.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { detailResponse, fixtureNotes } from "./__tests__/fixtures";
import { NoteDetailView } from "./note-detail-view";
import { HIDDEN_FIELDS } from "./trust-content";

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("note detail", () => {
  const detail = detailResponse(0, 1);
  const html = renderToStaticMarkup(<NoteDetailView detail={detail} protocolNow={(detail.note.escrituraDay - 45) * 86_400} />);
  const text = textOf(html);

  it("shows the note's public fields", () => {
    expect(html).toMatch(/<h1[^>]*>Note #<!-- -->1<\/h1>|<h1[^>]*>Note #1<\/h1>/);
    expect(text).toContain(detail.note.agent);
    for (const v of ["€15,000.00", "€7,500.00", "€3,750.00", "23 Jan 2027", "in 45 days"]) expect(text).toContain(v);
    expect(text).toContain(`0x${fixtureNotes()[0].commitment}`);
    expect(text).toContain(`0x${fixtureNotes()[0].nullifier}`);
    expect(text).toMatch(/Borrowed by card on this note €3,000\.00 in 2 draws/);
    expect(html).toContain(`href="/registry?q=${detail.note.agent}"`);
  });

  it("offers in-browser verification", () => {
    expect(text).toContain("Verify proof in your browser");
    expect(html).toMatch(/<button[^>]*>.*Verify proof<\/button>/s);
  });

  it("lists what the proof hides", () => {
    expect(text).toContain("What the proof hides");
    for (const field of HIDDEN_FIELDS) expect(text).toContain(field);
  });

  it("labels the 9 public signals and shows the proof points", () => {
    for (const name of ["agent_field", "total_commission_cents", "agent_commission_cents", "escritura_day", "commitment", "nullifier", "attester_ax", "attester_ay", "nullifier_secret_commitment"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain(`0x${fixtureNotes()[0].proof.a}`);
    expect(text).toContain(`0x${fixtureNotes()[0].proof.b}`);
    expect(text).toContain(`0x${fixtureNotes()[0].proof.c}`);
  });

  it("renders the events timeline", () => {
    expect(text).toContain("Note minted");
    expect(text).toContain("Credit line opened");
    expect(text).toContain("€349.00 borrowed against this note");
  });

  it("shows Overdue and keeps verification available without the registry's signals (it reads Stellar)", () => {
    const overdue = detailResponse(1, 2, { overdue: true });
    overdue.publicSignals = [];
    const html = renderToStaticMarkup(<NoteDetailView detail={overdue} />);
    const out = textOf(html);
    expect(out).toContain("Overdue");
    expect(out).toContain("The registry didn't return this note's public signals.");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>.*Verify proof/s);
  });

  it("lists the six verification steps before the first run", () => {
    for (const step of ["Load the verifier", "Fetch the verification key", "Read the note from Stellar", "Rebuild the public signals", "Match the proof", "Check the pairing equation"]) {
      expect(text).toContain(step);
    }
  });
});
