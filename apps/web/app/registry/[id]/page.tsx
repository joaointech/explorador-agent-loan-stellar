import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NoteDetail } from "@/components/registry/note-detail";
import { parseNoteIdParam } from "@/components/registry/registry-query";

export async function generateMetadata(props: PageProps<"/registry/[id]">): Promise<Metadata> {
  const id = parseNoteIdParam((await props.params).id);
  if (id === null) return { title: "Note not found" };
  return {
    title: `Note #${id}`,
    description: `CPCV Note #${id} on explorador advance: public deal data, events and the zero-knowledge proof, verifiable in your browser. No personal data.`,
  };
}

// One CPCV Note (spec §10.2 /registry/[id]): public fields, proof, public
// signals, timeline and in-browser verification. Data comes from
// GET /api/registry/[id] in the browser.
export default async function NotePage(props: PageProps<"/registry/[id]">) {
  const id = parseNoteIdParam((await props.params).id);
  if (id === null) notFound();
  return <NoteDetail key={id} id={id} />;
}
