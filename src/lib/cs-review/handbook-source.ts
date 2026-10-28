export interface HandbookSection { title: string; body: string }

// Parse headings, never commands or instructions in the source document.
export function parseHandbook(source: string) {
  const headings = [...source.matchAll(/^(#{1,3}) (.+)$/gm)];
  const sections = new Map<number, HandbookSection>();
  const recipes = new Map<string, HandbookSection>();
  headings.forEach((heading, index) => {
    const sectionNumber = heading[1] === '##' ? /^(\d+)\. /.exec(heading[2]) : null;
    const recipeId = heading[1] === '###' ? /^([A-F]\d+)\. /.exec(heading[2]) : null;
    if (!sectionNumber && !recipeId) return;
    const level = heading[1].length;
    const next = headings.slice(index + 1).find((candidate) => candidate[1].length <= level);
    const body = source.slice(heading.index! + heading[0].length, next?.index ?? source.length).replace(/\n---\s*$/, '').trim();
    const section = { title: heading[2], body };
    if (sectionNumber && Number(sectionNumber[1]) > 0) {
      const number = Number(sectionNumber[1]);
      if (sections.has(number)) throw new Error(`手册章节重复：${number}`);
      sections.set(number, section);
    }
    if (recipeId) recipes.set(recipeId[1], section);
  });
  return { sections, recipes };
}

export function chapterBody(section: HandbookSection, recipes: HandbookSection[]) {
  return `## 原理与解题方法\n\n${section.body}\n${recipes.length ? `\n## 专项解题\n\n${recipes.map((recipe) => `### ${recipe.title}\n\n${recipe.body}`).join('\n\n')}\n` : ''}`;
}
