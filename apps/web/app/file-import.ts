/** Read text documents without changing Markdown indentation or paragraph breaks. */
export async function readArticleFile(file: File): Promise<string> {
  if (/\.pdf$/i.test(file.name)) {
    if (file.size > 10_000_000) throw new Error('The PDF is too large (maximum 10 MB).');
    const response = await fetch('/api/import-pdf', {method:'POST',headers:{'Content-Type':'application/pdf'},body:file});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The PDF could not be read.');
    return result.text;
  }
  if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error('Please choose a TXT, Markdown or PDF file.');
  if (file.size > 800_000) throw new Error('The file is too large (maximum 200,000 characters).');
  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(await file.arrayBuffer()).trim();
  } catch {
    throw new Error('The file could not be read. Please use a UTF-8 text file.');
  }
  if (text.includes('\0')) throw new Error('The file contains binary data. Please choose a text file.');
  if (!text) throw new Error('The file is empty. Please choose a file with article text.');
  if (text.length > 200_000) throw new Error('The article is too long (maximum 200,000 characters).');
  return text;
}
