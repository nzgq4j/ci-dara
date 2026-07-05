// Real OOXML (.docx) export for the compliance matrix, built with the `docx` library.
// Replaces the old HTML-as-.doc trick (which made Word warn on open and wasn't true .docx).
// Landscape Letter, a branded navy header row, and one table row per requirement. Called from
// the matrix export server action; returns a Buffer the action base64-encodes for download.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  VerticalAlign,
  AlignmentType,
  PageOrientation
} from 'docx';

const NAVY = '1B2A4A';
const BORDER = '999999';

// Landscape Letter usable width (15840 twips − 2×720 margin) split across the 9 columns.
const COL_WIDTHS = [400, 2200, 3000, 1100, 1300, 1500, 1500, 1200, 2200];

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
const TABLE_BORDERS = {
  top: cellBorder,
  bottom: cellBorder,
  left: cellBorder,
  right: cellBorder,
  insideHorizontal: cellBorder,
  insideVertical: cellBorder
};

// A cell's text can contain newlines — render each line as its own paragraph so it wraps
// cleanly instead of collapsing. Empty text still needs one (empty) paragraph.
function cellParagraphs(text: string, opts: { bold?: boolean; color?: string; size: number }): Paragraph[] {
  const lines = String(text ?? '').split('\n');
  return lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, bold: opts.bold, color: opts.color, size: opts.size })]
      })
  );
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, color: 'auto', fill: NAVY },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: cellParagraphs(text, { bold: true, color: 'FFFFFF', size: 16 })
  });
}

function dataCell(text: string, width: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: cellParagraphs(text, { color: '1E293B', size: 18 })
  });
}

export interface MatrixDocInput {
  title: string;
  subtitle: string;
  cols: string[];
  rows: string[][];
}

/** Build the compliance-matrix .docx and return it as a Buffer. */
export async function buildMatrixDocx({ title, subtitle, cols, rows }: MatrixDocInput): Promise<Buffer> {
  const headerRow = new TableRow({
    tableHeader: true, // repeat the header on every page
    children: cols.map((c, i) => headerCell(c, COL_WIDTHS[i] ?? 1200))
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell, i) => dataCell(cell, COL_WIDTHS[i] ?? 1200))
      })
  );

  const table = new Table({
    columnWidths: COL_WIDTHS,
    width: { size: COL_WIDTHS.reduce((n, w) => n + w, 0), type: WidthType.DXA },
    borders: TABLE_BORDERS,
    rows: [headerRow, ...bodyRows]
  });

  const doc = new Document({
    creator: 'DARA · Crucible Insight',
    title,
    styles: { default: { document: { run: { font: 'Calibri' } } } },
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 720, right: 720 }
          }
        },
        children: [
          new Paragraph({
            spacing: { after: 60 },
            children: [new TextRun({ text: title, bold: true, color: NAVY, size: 30 })]
          }),
          new Paragraph({
            spacing: { after: 160 },
            children: [new TextRun({ text: subtitle, color: '64748B', size: 18 })]
          }),
          table
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}
