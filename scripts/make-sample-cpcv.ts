// Writes docs/samples/cpcv-exemplo.pdf: a synthetic, signed-looking Portuguese
// CPCV (contrato-promessa de compra e venda) with obviously fictitious people,
// tax numbers and address, for trying "Upload the signed CPCV (PDF)" on
// /admin/cpcvs/new. Deterministic: the same bytes on every run.
//
//   pnpm --filter @advance/scripts sample:cpcv
//
// What Claude should read from it: buyers "Maria Exemplo Silva e Rui Teste
// Costa" (NIF 234567899, the first buyer's; 211111112 in the note), seller
// Construções Fictícias Exemplo, Lda. (NIPC 500000000, represented by its
// manager), a flat under construction in Rua dos Testes Fictícios 42, 3.º Esq.,
// 1100-999 Lisboa, price €300,000.00, signed on 20 Oct 2026, deed within 24
// months (20 Oct 2028), no agency commission stated. Every NIF passes the
// mod-11 check digit. The signing date is in the past for any protocol clock,
// and the off-plan deadline stays ahead of a demo clock fast-forwarded by
// months (the testnet demo was at Nov 2027 when this was written).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "docs", "samples", "cpcv-exemplo.pdf");

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 64;
const WIDTH = A4[0] - 2 * MARGIN;
const SIGNED_AT = new Date(Date.UTC(2026, 9, 20, 10, 0, 0));

type Block =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "space"; size: number }
  | { kind: "signatures"; lines: [string, string][] };

const BLOCKS: Block[] = [
  { kind: "title", text: "CONTRATO-PROMESSA DE COMPRA E VENDA" },
  { kind: "subtitle", text: "(fração autónoma em construção, destinada a habitação)" },
  { kind: "space", size: 10 },
  { kind: "para", text: "Entre:" },
  {
    kind: "para",
    text:
      "PRIMEIRA OUTORGANTE (Promitente-Vendedora): CONSTRUÇÕES FICTÍCIAS EXEMPLO, LDA., pessoa coletiva n.º 500 000 000, com sede na Avenida da Simulação, n.º 7, 4000-999 Porto, neste ato representada pelo seu gerente, JOÃO FICTÍCIO PEREIRA, contribuinte fiscal n.º 123 456 789, com poderes para o ato;",
  },
  {
    kind: "para",
    text:
      "SEGUNDOS OUTORGANTES (Promitentes-Compradores): MARIA EXEMPLO SILVA, contribuinte fiscal n.º 234 567 899, e RUI TESTE COSTA, contribuinte fiscal n.º 211 111 112, casados entre si sob o regime da comunhão de adquiridos, residentes na Travessa do Ensaio, n.º 3, 2.º Dto., 1000-999 Lisboa;",
  },
  { kind: "para", text: "é celebrado o presente contrato-promessa de compra e venda, que se rege pelas cláusulas seguintes:" },
  { kind: "heading", text: "Cláusula Primeira (Objeto)" },
  {
    kind: "para",
    text:
      "A Primeira Outorgante é dona do prédio urbano, em construção, sito na Rua dos Testes Fictícios, n.º 42, 1100-999 Lisboa, descrito na Conservatória do Registo Predial de Lisboa sob o n.º 0000 (dados fictícios), que será constituído em regime de propriedade horizontal, e do qual fará parte a fração autónoma correspondente ao terceiro andar esquerdo (3.º Esq.), destinada a habitação, com a área e as características constantes do projeto aprovado.",
  },
  {
    kind: "para",
    text:
      "Pelo presente contrato, a Primeira Outorgante promete vender aos Segundos Outorgantes, e estes prometem comprar-lhe, a referida fração, livre de ónus, encargos e responsabilidades.",
  },
  { kind: "heading", text: "Cláusula Segunda (Preço e pagamento)" },
  {
    kind: "para",
    text:
      "O preço da prometida compra e venda é de € 300.000,00 (trezentos mil euros), que será pago da seguinte forma: a) € 30.000,00 (trinta mil euros), nesta data, a título de sinal e princípio de pagamento, de que a Primeira Outorgante dá quitação; b) € 270.000,00 (duzentos e setenta mil euros), no ato da escritura pública de compra e venda.",
  },
  { kind: "heading", text: "Cláusula Terceira (Escritura)" },
  {
    kind: "para",
    text:
      "Atenta a conclusão da obra, prevista para o ano de 2028, a escritura pública de compra e venda será celebrada no prazo máximo de 24 (vinte e quatro) meses a contar da data da assinatura do presente contrato, em dia, hora e local a indicar pela Primeira Outorgante, por carta registada ou correio eletrónico, com a antecedência mínima de 15 (quinze) dias.",
  },
  { kind: "heading", text: "Cláusula Quarta (Incumprimento)" },
  {
    kind: "para",
    text:
      "O incumprimento definitivo por parte dos Segundos Outorgantes confere à Primeira Outorgante o direito de fazer seu o sinal recebido; o incumprimento definitivo por parte da Primeira Outorgante confere aos Segundos Outorgantes o direito de exigir o sinal em dobro, nos termos do artigo 442.º do Código Civil.",
  },
  { kind: "heading", text: "Cláusula Quinta (Mediação)" },
  {
    kind: "para",
    text:
      "O presente negócio foi promovido com a intervenção de uma empresa de mediação imobiliária, cuja remuneração é objeto de contrato de mediação autónomo, não fazendo parte do presente contrato.",
  },
  { kind: "heading", text: "Cláusula Sexta (Disposições finais)" },
  {
    kind: "para",
    text:
      "As partes prescindem do reconhecimento presencial das assinaturas e da certificação da licença de utilização, previstos no n.º 3 do artigo 410.º do Código Civil, não podendo invocar a sua falta. O presente contrato é feito em dois exemplares, ficando um na posse de cada uma das partes.",
  },
  { kind: "space", size: 14 },
  { kind: "para", text: "Lisboa, 20 de outubro de 2026." },
  { kind: "space", size: 18 },
  {
    kind: "signatures",
    lines: [
      ["Pela Primeira Outorgante (o gerente)", "João Fictício Pereira"],
      ["Os Segundos Outorgantes", "Maria Exemplo Silva"],
      ["", "Rui Teste Costa"],
    ],
  },
];

const BANNER = "EXEMPLO FICTÍCIO · documento de demonstração do explorador advance · pessoas, empresa, NIFs e morada inventados · sem valor legal";

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function main() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("Contrato-promessa de compra e venda (exemplo fictício)");
  doc.setAuthor("explorador advance (dados fictícios)");
  doc.setSubject("CPCV de demonstração para o upload em /admin/cpcvs/new");
  doc.setKeywords(["CPCV", "exemplo", "fictício", "explorador advance"]);
  doc.setProducer("explorador advance scripts/make-sample-cpcv.ts (pdf-lib)");
  doc.setCreator("explorador advance");
  doc.setLanguage("pt-PT");
  doc.setCreationDate(SIGNED_AT);
  doc.setModificationDate(SIGNED_AT);

  const regular = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.1, 0.1, 0.12);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage(A4);
    pages.push(page);
    y = A4[1] - MARGIN - 10;
  };
  const ensure = (height: number) => {
    if (y - height < MARGIN + 40) newPage();
  };
  const text = (s: string, font: PDFFont, size: number, x = MARGIN) => {
    page.drawText(s, { x, y, size, font, color: ink });
  };

  newPage();
  for (const block of BLOCKS) {
    switch (block.kind) {
      case "title": {
        ensure(24);
        const size = 15;
        text(block.text, bold, size, MARGIN + (WIDTH - bold.widthOfTextAtSize(block.text, size)) / 2);
        y -= 20;
        break;
      }
      case "subtitle": {
        const size = 11;
        text(block.text, regular, size, MARGIN + (WIDTH - regular.widthOfTextAtSize(block.text, size)) / 2);
        y -= 16;
        break;
      }
      case "heading":
        ensure(30);
        y -= 6;
        text(block.text, bold, 11.5);
        y -= 16;
        break;
      case "para": {
        const lines = wrap(block.text, regular, 11, WIDTH);
        for (const line of lines) {
          ensure(15);
          text(line, regular, 11);
          y -= 15;
        }
        y -= 5;
        break;
      }
      case "space":
        y -= block.size;
        break;
      case "signatures":
        for (const [role, name] of block.lines) {
          ensure(52);
          if (role) text(`${role}:`, regular, 11);
          y -= 26;
          page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 230, y }, thickness: 0.6, color: ink });
          // An ink-blue "signature" over the line, so the copy reads as signed.
          page.drawText(name, { x: MARGIN + 8, y: y + 4, size: 14, font: italic, color: rgb(0.08, 0.2, 0.55), opacity: 0.85 });
          y -= 14;
          text(`(${name})`, regular, 9.5);
          y -= 24;
        }
        break;
    }
  }

  pages.forEach((p, i) => {
    p.drawRectangle({ x: 0, y: A4[1] - 26, width: A4[0], height: 26, color: rgb(0.86, 0.15, 0.15) });
    p.drawText(BANNER, { x: MARGIN - 30, y: A4[1] - 17, size: 8, font: sans, color: rgb(1, 1, 1) });
    p.drawText("EXEMPLO FICTÍCIO", { x: 120, y: 330, size: 54, font: sans, color: rgb(0.86, 0.15, 0.15), opacity: 0.08, rotate: degrees(35) });
    const footer = `Página ${i + 1} de ${pages.length} · rubricas: JFP / MES / RTC`;
    p.drawText(footer, { x: MARGIN, y: 36, size: 8.5, font: sans, color: rgb(0.4, 0.4, 0.45) });
  });

  const bytes = await doc.save({ useObjectStreams: false });
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, bytes);
  console.log(`wrote ${path.relative(REPO, OUT)} (${pages.length} pages, ${bytes.length} bytes)`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
