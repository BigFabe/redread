import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractPdfText} from '../apps/web/app/pdf-import';
import {readArticleFile} from '../apps/web/app/file-import';

function pdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(source.length);
    source += `${i+1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return source;
}
const request = (body: string | Uint8Array) => new Request('http://localhost/api/import-pdf', {method:'POST', body:body as BodyInit});

test('extract PDF text without page-number decorations',async()=>{
  assert.equal(await extractPdfText(request(pdf('An article from a PDF.'))),'An article from a PDF.');
});

test('report scanned, damaged, non-PDF and oversized files',async()=>{
  await assert.rejects(extractPdfText(request(pdf(''))),/OCR/);
  await assert.rejects(extractPdfText(request('%PDF-1.4\nbroken')),/damaged/);
  await assert.rejects(extractPdfText(request('not a pdf')),/valid PDF/);
  await assert.rejects(extractPdfText(request(new Uint8Array(10_000_001))),/too large/);
  await assert.rejects(readArticleFile(new File([new Uint8Array(10_000_001)],'large.pdf')),/too large/);
});

test('PDF file reader calls the extraction endpoint and propagates errors',async(t)=>{
  t.mock.method(globalThis,'fetch',async(url: string, init: RequestInit)=>{
    assert.equal(url,'/api/import-pdf');
    assert.equal(init.method,'POST');
    return Response.json({text:'Extracted article'});
  });
  assert.equal(await readArticleFile(new File([pdf('hello')],'article.PDF')),'Extracted article');
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'PDF requires OCR'},{status:400}));
  await assert.rejects(readArticleFile(new File([pdf('')],'scan.pdf')),/OCR/);
});
