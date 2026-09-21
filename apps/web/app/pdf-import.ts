import { PDFParse } from 'pdf-parse';

const maxBytes = 10_000_000;

export async function extractPdfText(req: Request): Promise<string> {
  if (Number(req.headers.get('content-length')) > maxBytes) throw new Error('The PDF is too large (maximum 10 MB).');
  const reader = req.body?.getReader();
  if (!reader) throw new Error('The PDF is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('The PDF is too large (maximum 10 MB).');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = Buffer.concat(chunks);
  if (!data.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('The file is not a valid PDF.');
  const parser = new PDFParse({data});
  try {
    let text: string;
    try {
      const result = await parser.getText({pageJoiner: ''});
      text = result.text.trim();
    } catch {
      throw new Error('The PDF could not be read. It may be damaged or password-protected.');
    }
    if (!text) throw new Error('The PDF contains no readable text. Scanned PDFs require OCR and are not supported.');
    if (text.length > 200_000) throw new Error('The article is too long (maximum 200,000 characters).');
    return text;
  } finally {
    await parser.destroy();
  }
}
