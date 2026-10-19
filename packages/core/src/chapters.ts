import type { AudioChapter } from './types';

export const chapterPrompt = `Navigation format (takes precedence over conflicting formatting instructions above): Preserve every actual chapter or section heading from the source on its own line as "## Heading". Keep its original language and wording, apart from necessary speech normalization. Use consistent titles without leading outline numbers: write "Ziele" instead of "2.2 Ziele" or "Zwei Punkt zwei: Ziele". Omit these structural prefixes from all headings, including top-level ones; do not spell them out. Preserve meaningful labels within a title, such as "Forschungsfrage eins" or "Arbeitspaket zwei". Recognize both Markdown headings and clearly identifiable plain-text headings. Do not invent headings, turn ordinary paragraphs into headings, or add headings at excerpt boundaries. If an excerpt continues a section, continue its prose without repeating the heading. Keep the heading text in the spoken content; only the ## prefix is navigation metadata. Text without headings must remain without headings.`;

const numericPrefix = /^\d+(?:\.\d+)*(?:[.):]\s*|\s+)/u;
const numberWords = 'eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf';
const spokenPrefix = new RegExp(`^(?:${numberWords})(?:\\s+Punkt\\s+(?:${numberWords}))*(?:[.):]\\s*|\\s+)`, 'iu');

/** The player already numbers chapters; keep outline numbers out of their titles. */
function chapterTitle(title: string): string {
  const text = title.replace(/\[break\]/gi, '').replace(/\s+/g, ' ').trim();
  return text.replace(numericPrefix, '').replace(spokenPrefix, '').trim() || text;
}

/** Technical chunk boundaries are never chapter boundaries. */
export function chapterSections(text: string): {title?: string; text: string}[] {
  const headings = Array.from(text.matchAll(/^#{1,6}[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*\r?$/gm));
  if (!headings.length) return text.trim() ? [{text: text.trim()}] : [];
  const sections: {title?: string; text: string}[] = [];
  const intro = text.slice(0, headings[0].index).trim();
  if (intro) sections.push({text: intro});
  headings.forEach((heading, index) => sections.push({
    title: chapterTitle(heading[1]),
    text: text.slice(heading.index, headings[index + 1]?.index).trim(),
  }));
  return sections;
}

/** Chapters live with the generation recipe, including archived audio versions. */
export function chaptersFromRecipe(recipe: string): AudioChapter[] {
  try {
    const chapters: unknown = JSON.parse(recipe || '{}').chapters;
    if (!Array.isArray(chapters)) return [];
    const result: AudioChapter[] = [];
    for (const chapter of chapters) {
      if (typeof chapter?.title !== 'string' || !chapter.title.trim() || !Number.isFinite(chapter.startTime) || chapter.startTime < 0) continue;
      if (result.length && chapter.startTime <= result[result.length - 1].startTime) continue;
      result.push({title: chapterTitle(chapter.title), startTime: chapter.startTime});
    }
    return result;
  } catch { return []; }
}

export function chapterMetadata(chapters: AudioChapter[], duration: number): string {
  const escape = (title: string) => title.replace(/[\r\n]/g, ' ').replace(/([\\=;#])/g, '\\$1');
  return ';FFMETADATA1\n' + chapters.map((chapter, index) =>
    `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.startTime * 1000)}\nEND=${Math.round((chapters[index + 1]?.startTime ?? duration) * 1000)}\ntitle=${escape(chapter.title)}\n`,
  ).join('');
}
